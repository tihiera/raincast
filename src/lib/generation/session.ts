import type { GenerationStatus } from "./types";
import type { GenerationManifest, ManifestCheckpoint } from "./manifest";
import { createManifest } from "./manifest";
import type { AiProvider, GenerationPlan, Diagnostic, InvestigationPlan, InvestigationContext, BackendCommand } from "../ai/types";
import { formatMessages, extractImages, buildReviewPlan, buildGenerateRustBackend, parseJson } from "../ai/prompts";
import { replaceBlock, NotFound, AmbiguousMatch } from "@rain/editkit/core";
import type { ChatMessage } from "../chat/types";
import { initProject, stageFiles, applyCheckpoint, runValidation, rollbackSnapshot, readProjectFile, readProjectSourceFiles, listDir, grepProjectFiles, getSystemInfo } from "../tauri/workspace";
import type { DirEntry } from "../tauri/workspace";
import { type ScaffoldTier, type LayoutArchetype, getScaffold } from "./scaffolds";
import { runAgentLoop, runRustAgentLoop } from "../ai/agentLoop";
import { generateSourceManifest, updateManifest, formatManifest, type SourceManifest } from "./sourceManifest";

const MAX_FIX_ITERS = 5;
const MAX_CHECKPOINTS = 20;

/** Returns elapsed time formatted as "1.2s" or "345ms" */
function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Yield to the event loop so React can flush state updates (real-time logs). */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export interface SessionConfig {
  provider: AiProvider;
  projectId: string;
  messages: ChatMessage[];
  mode: "build" | "edit";
  scaffoldTier?: ScaffoldTier;
  /** Layout archetype from LLM classification. Falls back to keyword matching if not provided. */
  layoutArchetype?: LayoutArchetype;
  onStatus: (status: GenerationStatus) => void;
  onLog?: (line: string) => void;
  /** Push a status message into the chat (plan, progress, success, error). */
  onChatStatus?: (msg: ChatMessage) => void;
  /** Update an existing status message's content (for streaming). */
  onChatStatusAppend?: (id: string, textChunk: string) => void;
  onSnapshotApplied?: (snapshotId: string) => void;
  /** Called when a previously-registered snapshot is rolled back (e.g. selfHeal failure). */
  onSnapshotRolledBack?: (count: number) => void;
  onFirstCheckpointApplied?: () => void;
  /** Ephemeral tool status during agent loop. null = clear. */
  onToolStatus?: (status: { text: string; tool?: string; args?: string } | null) => void;
  /** Called when the agent renames the project via rename_project tool. */
  onProjectRenamed?: (newName: string) => void;
  /** Returns current runtime console errors from the preview iframe (if any). */
  getRuntimeErrors?: () => string[];
}

/** Shared status signal between frontend and Rust backend generation. */
interface BackendSignal {
  phase: "idle" | "generating" | "compiling" | "verifying" | "done" | "failed";
  turn: number;
  maxTurns: number;
  lastStatus: string;
  success: boolean;
  error?: string;
}

export class GenerationSession {
  private aborted = false;
  private config: SessionConfig;
  manifest: GenerationManifest | null = null;
  appliedSnapshots: string[] = [];
  private firstCheckpointDone = false;
  private totalCheckpointsProcessed = 0;
  private depsInstalled = false;
  /** Lightweight file summaries used by the agent loop */
  sourceManifest: SourceManifest | null = null;
  /** Shared signal for Rust backend status — updated by the agent, read by the session. */
  private backendSignal: BackendSignal = {
    phase: "idle", turn: 0, maxTurns: 0, lastStatus: "", success: false,
  };

  constructor(config: SessionConfig) {
    this.config = config;
  }

  cancel(): void {
    this.aborted = true;
  }

  private log(line: string): void {
    this.config.onLog?.(line);
  }

  /**
   * Stream a natural-language completion message using the fast model.
   * Pushes an empty assistant message first, then streams LLM text into it.
   */
  private async streamChatStatus(_type: "success" | "error", context: string, opts?: {
    tasks?: Array<{ file: string; description: string }>;
    detail?: string;
    /** Clean fallback text shown if the AI stream fails. Avoids leaking raw prompts into the UI. */
    fallback?: string;
  }): Promise<void> {
    const msgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Push the initial empty assistant message (renders as a normal AI bubble)
    this.config.onChatStatus?.({
      id: msgId,
      role: "assistant",
      content: "",
    });

    // Stream LLM-generated natural text into it
    try {
      await this.config.provider.streamBriefStatus({
        context,
        onChunk: (text) => {
          this.config.onChatStatusAppend?.(msgId, text);
        },
      });
    } catch {
      // Use the clean fallback, never dump raw prompt context into the UI
      this.config.onChatStatusAppend?.(msgId, opts?.fallback ?? context);
    }
  }

  private async ensureDepsInstalled(projectId: string): Promise<void> {
    if (this.depsInstalled) return;
    this.log(`[deps] Running npm install...`);
    const result = await runValidation(projectId, ["npm install"]);
    if (result.ok) {
      this.log(`[deps] npm install completed successfully`);
    } else {
      this.log(`[deps] npm install exited with code ${result.exit_code}`);
      if (result.stderr_tail.length > 0) {
        for (const line of result.stderr_tail.slice(-5)) {
          this.log(`  ${line}`);
        }
      }
    }
    this.depsInstalled = true;
  }

  private logFileContent(path: string, content: string): void {
    this.log(`  ┌── ${path} ──`);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      this.log(`  │ ${String(i + 1).padStart(3)} │ ${lines[i]}`);
    }
    this.log(`  └── end ${path} (${lines.length} lines) ──`);
  }

  async run(): Promise<void> {
    const { provider, projectId, messages, mode, onStatus } = this.config;
    const tier = this.config.scaffoldTier ?? "standard";

    // Layout archetype comes from LLM classification in analyzeQuery
    const archetype = this.config.layoutArchetype;

    // Fetch system info early — used by both frontend and backend generation prompts
    let systemInfo: { os: string; arch: string; home_dir: string; desktop_dir: string; documents_dir: string; downloads_dir: string } | undefined;
    try {
      systemInfo = await getSystemInfo();
      this.log(`  System: ${systemInfo.os} (${systemInfo.arch}), home: ${systemInfo.home_dir}`);
    } catch {
      this.log("  Could not fetch system info — AI will use defaults");
    }

    try {
      // ── Init workspace ──
      this.log("── Initializing Workspace ──");
      onStatus({ phase: "planning", message: "Initializing workspace..." });
      let t0 = Date.now();
      await initProject(projectId);
      this.log(`  Workspace ready (${elapsed(t0)})`);
      if (this.aborted) return;

      // Build scaffold after the first await so the UI can render name picker concurrently
      const scaffold = getScaffold(tier, mode === "build" ? archetype : undefined);

      // ── Scaffold ──
      if (mode === "build") {
        this.log("");
        this.log("── Setting Up Scaffold ──");
        this.log(`  Template: ${scaffold.name} (${scaffold.files.length} files)`);
        if (archetype) {
          this.log(`  Layout archetype: ${archetype}`);
        }
        onStatus({ phase: "staging", message: `Setting up ${scaffold.name} scaffold...` });

        t0 = Date.now();
        const scaffoldGenId = "scaffold-" + Date.now().toString(36);
        await stageFiles(projectId, scaffoldGenId, scaffold.files);
        const scaffoldPaths = scaffold.files.map((f) => f.path);
        const scaffoldResult = await applyCheckpoint(projectId, scaffoldGenId, scaffoldPaths);
        this.appliedSnapshots.push(scaffoldResult.snapshot_id);
        this.config.onSnapshotApplied?.(scaffoldResult.snapshot_id);
        for (const p of scaffoldPaths) {
          this.log(`  ✓ ${p}`);
        }
        this.log(`  Scaffold applied → snapshot ${scaffoldResult.snapshot_id} (${elapsed(t0)})`);

        // Install deps
        this.log("");
        this.log("── Installing Dependencies ──");
        onStatus({ phase: "staging", message: "Installing dependencies..." });
        t0 = Date.now();
        await this.ensureDepsInstalled(projectId);
        this.log(`  Dependencies installed (${elapsed(t0)})`);
        if (this.aborted) return;
      }

      // ── Plan ──
      this.log("");
      this.log("── Planning ──");
      this.log(`  Mode: ${mode}`);
      this.log(`  Scaffold: ${scaffold.name} (${scaffold.files.length} base files)`);
      this.log(`  Requesting plan from AI...`);
      onStatus({ phase: "planning", message: "Requesting build plan from AI..." });

      // For edit mode, read existing source files for manifest generation
      let existingFiles: Record<string, string> | undefined;
      if (mode === "edit") {
        this.log("  Reading existing source files...");
        onStatus({ phase: "planning", message: "Reading existing files..." });
        t0 = Date.now();
        try {
          existingFiles = await readProjectSourceFiles(projectId);
          const fileCount = Object.keys(existingFiles).length;
          this.log(`  Found ${fileCount} source file(s) (${elapsed(t0)})`);
        } catch {
          this.log(`  Could not read existing files — proceeding without context (${elapsed(t0)})`);
        }
      }

      // ── EDIT MODE: Agent loop with tool calling ──
      if (mode === "edit" && existingFiles && Object.keys(existingFiles).length > 0) {
        // Generate file manifest (lightweight summaries) for the agent
        this.log("  Generating file manifest...");
        onStatus({ phase: "planning", message: "Analyzing project structure..." });
        this.config.onToolStatus?.({ text: "Reading and summarizing source files..." });
        t0 = Date.now();
        this.sourceManifest = await generateSourceManifest(provider, existingFiles);
        const manifestStr = formatManifest(this.sourceManifest);
        this.config.onToolStatus?.(null);
        this.log(`  Manifest ready (${Object.keys(this.sourceManifest.files).length} files, ${elapsed(t0)})`);
        this.log(`  Manifest:\n${manifestStr}`);
        if (this.aborted) return;
        // ── Run the agent loop ──
        this.log("");
        this.log("── Agent Loop ──");
        onStatus({ phase: "generating", message: "Working on your changes..." });

        let lastAgentStatus = "";
        const agentImages = extractImages(messages);
        const agentResult = await runAgentLoop({
          projectId,
          messages,
          manifest: manifestStr,
          images: agentImages.length > 0 ? agentImages : undefined,
          generate: (system, user, images) => provider.rawGenerate({
            system,
            user,
            json: true,
            model: "pro",
            images,
          }),
          onStatus: (text) => {
            lastAgentStatus = text;
            onStatus({ phase: "generating", message: text });
            this.config.onToolStatus?.({ text });
          },
          onToolCall: (toolName, toolArgs) => {
            this.config.onToolStatus?.({ text: lastAgentStatus, tool: toolName, args: toolArgs });
          },
          onRenameProject: (newName) => {
            this.config.onProjectRenamed?.(newName);
          },
          onLog: (line) => this.log(line),
          isAborted: () => this.aborted,
        });

        // Clear tool status when agent loop finishes
        this.config.onToolStatus?.(null);

        if (this.aborted) return;

        // Collect modified files from the agent
        const fixedFiles: Array<{ path: string; content: string }> = [];
        for (const [path, content] of agentResult.modifiedFiles) {
          fixedFiles.push({ path, content });
        }

        if (fixedFiles.length === 0) {
          this.log("  Agent made no file changes");
          await this.streamChatStatus("success", agentResult.message);
          onStatus({ phase: "ready", message: "No changes needed" });
          return;
        }

        // Update the source manifest with changed files
        if (this.sourceManifest) {
          const changedFileContents: Record<string, string> = {};
          for (const f of fixedFiles) changedFileContents[f.path] = f.content;
          this.sourceManifest = await updateManifest(provider, this.sourceManifest, changedFileContents);
          this.log(`  Updated manifest for ${fixedFiles.length} changed file(s)`);
        }

        // Stage, checkpoint, validate, heal — same as before
        const editLabel = agentResult.message.slice(0, 80);
        const editCheckpoints: ManifestCheckpoint[] = [{
          id: "edit-1",
          label: editLabel,
          files: fixedFiles.map((f) => ({ path: f.path, hash: simpleHash(f.content) })),
        }];
        this.manifest = createManifest(projectId, editCheckpoints);

        this.log("");
        this.log(`── Staging ${fixedFiles.length} file(s) ──`);
        onStatus({ phase: "staging", message: `Staging ${fixedFiles.length} file(s)...` });
        t0 = Date.now();
        await stageFiles(projectId, this.manifest.genId, fixedFiles);
        for (const f of fixedFiles) {
          this.log(`  ✓ staged ${f.path}`);
          this.logFileContent(f.path, f.content);
        }
        this.log(`  Staging done (${elapsed(t0)})`);
        if (this.aborted) return;

        this.log("  Applying checkpoint...");
        onStatus({ phase: "checkpoint", message: `Applying changes...` });
        t0 = Date.now();
        const filePaths = fixedFiles.map((f) => f.path);
        const editApplyResult = await applyCheckpoint(projectId, this.manifest.genId, filePaths);
        this.log(`  Applied → snapshot ${editApplyResult.snapshot_id} (${elapsed(t0)})`);
        this.appliedSnapshots.push(editApplyResult.snapshot_id);
        this.config.onSnapshotApplied?.(editApplyResult.snapshot_id);
        if (this.aborted) return;

        if (!this.firstCheckpointDone) {
          this.firstCheckpointDone = true;
          this.config.onFirstCheckpointApplied?.();
        }

        if (filePaths.some((p) => p === "package.json" || p.endsWith("/package.json"))) {
          this.depsInstalled = false;
        }
        t0 = Date.now();
        await this.ensureDepsInstalled(projectId);
        this.log(`  Dependencies check (${elapsed(t0)})`);
        if (this.aborted) return;

        this.log("  Validating TypeScript...");
        onStatus({ phase: "validating", message: "Validating changes..." });
        t0 = Date.now();
        const validation = await runValidation(projectId, ["npx tsc --noEmit"]);
        this.log(`  Validation done (${elapsed(t0)})`);
        if (this.aborted) return;

        if (!validation.ok) {
          this.log(`  ✗ Validation FAILED — entering self-heal...`);
          const healed = await this.selfHealLoop(
            editLabel,
            validation.stdout_tail,
            validation.stderr_tail,
            filePaths,
            editApplyResult.snapshot_id,
            fixedFiles.length,
            fixedFiles.length,
          );
          if (!healed) {
            this.config.onSnapshotRolledBack?.(1);
            return;
          }
        } else {
          this.log("  ✓ Validation passed");
        }

        this.log("");
        this.log("── Edit Complete ──");
        await this.streamChatStatus("success", agentResult.message);
        onStatus({ phase: "ready", message: "Preview is ready" });
        return;
      }

      // ── BUILD MODE (or edit fallback): two-step generation ──
      // Step 1: Get lightweight plan (file paths + descriptions, no code)
      this.log("  Step 1: Planning build structure...");
      onStatus({ phase: "planning", message: "Planning build structure..." });
      t0 = Date.now();

      if (mode === "edit" && existingFiles) {
        // Edit fallback — use the old single-shot approach
        const plan = await provider.generatePlan({
          messages,
          mode,
          scaffoldContext: scaffold.promptContext,
          protectedFiles: scaffold.protectedFiles,
          existingFiles,
          systemInfo,
        });
        this.log(`  AI plan received (${elapsed(t0)})`);
        await flush();
        if (this.aborted) return;

        if (plan.checkpoints.length === 0) {
          this.log("  ERROR: AI returned empty plan (0 checkpoints)");
          await this.streamChatStatus("error", "The build plan came back empty — the AI couldn't figure out what to generate. The user should try describing their app differently.");
          onStatus({
            phase: "failed",
            error: { title: "Empty plan", detail: "The AI returned no checkpoints. Try rephrasing your request." },
          });
          return;
        }

        // For edit fallback, use the old single-shot execute path
        this.log("");
        this.log("── Plan Received (edit fallback) ──");
        this.log(`  Checkpoints: ${plan.checkpoints.length}`);
        this.log(`  Total files: ${plan.filesTotal}`);
        this.log("");
        for (let i = 0; i < plan.checkpoints.length; i++) {
          const cp = plan.checkpoints[i];
          const isLast = i === plan.checkpoints.length - 1;
          this.log(`  ${isLast ? "└─" : "├─"} ${cp.label}`);
          for (let j = 0; j < cp.files.length; j++) {
            const f = cp.files[j];
            const prefix = isLast ? "     " : "  │  ";
            const connector = j === cp.files.length - 1 ? "└─" : "├─";
            this.log(`${prefix}${connector} ${f.path}`);
          }
        }
        this.log("");

        onStatus({
          phase: "generating",
          message: `Applying ${plan.checkpoints.length} checkpoint(s)...`,
          filesTotal: plan.filesTotal,
          filesDone: 0,
        });
        for (const cp of plan.checkpoints) {
          for (const f of cp.files) {
            this.logFileContent(f.path, f.content);
          }
        }
        const checkpoints: ManifestCheckpoint[] = plan.checkpoints.map((cp) => ({
          id: cp.id,
          label: cp.label,
          files: cp.files.map((f) => ({ path: f.path, hash: simpleHash(f.content) })),
        }));
        this.manifest = createManifest(projectId, checkpoints);
        const success = await this.executeCheckpoints(plan);
        if (this.aborted) return;
        if (!success) return;

        this.log("");
        this.log("── Generation Complete ──");
        this.log("  All checkpoints applied successfully. Preview is ready.");
        await this.streamChatStatus("success", `Build complete — all ${plan.checkpoints.length} checkpoints applied successfully and the preview is ready.`);
        onStatus({
          phase: "ready",
          message: "Preview is ready",
          filesDone: plan.filesTotal,
          filesTotal: plan.filesTotal,
        });
        return;
      }

      // Two-step build: plan structure first, then generate files per checkpoint
      this.config.onToolStatus?.({ text: "Designing the app structure..." });
      t0 = Date.now();
      const planResult = await provider.planBuild({
        messages,
        scaffoldContext: scaffold.promptContext,
        protectedFiles: scaffold.protectedFiles,
      });
      const initialPlan = planResult.plan;
      this.log(`  Initial plan received (${elapsed(t0)})`);
      this.config.onToolStatus?.(null);
      await flush();
      if (this.aborted) return;

      this.log("");
      this.log("── Raw Build Plan Response ──");
      this.log(planResult.rawResponse);
      this.log("── End Raw Build Plan Response ──");

      if (initialPlan.checkpoints.length === 0) {
        this.log("  ERROR: AI returned empty plan (0 checkpoints)");
        await this.streamChatStatus("error", "The build plan came back empty — the AI couldn't figure out what to generate. The user should try describing their app differently.");
        onStatus({
          phase: "failed",
          error: { title: "Empty plan", detail: "The AI returned no checkpoints. Try rephrasing your request." },
        });
        return;
      }

      // ── Plan review: enrich descriptions, fill data gaps, verify interactivity ──
      this.log("");
      this.log("── Reviewing plan for completeness ──");
      this.config.onToolStatus?.({ text: "Reviewing plan for completeness..." });
      t0 = Date.now();

      const conversation = formatMessages(messages);
      const reviewPrompt = buildReviewPlan({
        conversation,
        plan: JSON.stringify(initialPlan, null, 2),
        scaffoldContext: scaffold.promptContext,
      });
      const reviewRaw = await provider.rawGenerate({
        system: reviewPrompt.system,
        user: reviewPrompt.user,
        json: true,
        model: "pro",
      });
      if (this.aborted) return;

      const reviewResult = parseJson<{ checkpoints: typeof initialPlan.checkpoints; backendCommands?: BackendCommand[]; changes?: string }>(reviewRaw);
      const buildPlan = reviewResult && reviewResult.checkpoints?.length > 0
        ? { checkpoints: reviewResult.checkpoints, backendCommands: reviewResult.backendCommands }
        : initialPlan;

      // Merge backend commands from initial plan and review
      const backendCommands: BackendCommand[] = buildPlan.backendCommands
        ?? initialPlan.backendCommands
        ?? [];

      const reviewChanges = reviewResult?.changes ?? "No changes";
      this.log(`  Plan review done (${elapsed(t0)}): ${reviewChanges}`);
      this.log("");
      this.log("── Reviewed Plan Response ──");
      this.log(reviewRaw);
      this.log("── End Reviewed Plan Response ──");
      this.config.onToolStatus?.(null);
      await flush();
      if (this.aborted) return;

      // Show plan summary
      const totalFiles = buildPlan.checkpoints.reduce((sum, cp) => sum + cp.files.length, 0);
      this.log("");
      this.log("── Build Plan ──");
      this.log(`  Checkpoints: ${buildPlan.checkpoints.length}`);
      this.log(`  Total files: ${totalFiles}`);
      this.log("");
      for (let i = 0; i < buildPlan.checkpoints.length; i++) {
        const cp = buildPlan.checkpoints[i];
        const isLast = i === buildPlan.checkpoints.length - 1;
        this.log(`  ${isLast ? "└─" : "├─"} ${cp.label}`);
        for (let j = 0; j < cp.files.length; j++) {
          const f = cp.files[j];
          const prefix = isLast ? "     " : "  │  ";
          const connector = j === cp.files.length - 1 ? "└─" : "├─";
          this.log(`${prefix}${connector} ${f.path} — ${f.description}`);
        }
      }
      this.log("");

      // Stream a natural-language plan summary to the user while code generation starts
      const planSummaryContext = buildPlan.checkpoints
        .map((cp) => `${cp.label}: ${cp.files.map(f => f.description).join("; ")}`)
        .join("\n");
      // Fire-and-forget — streams in the background while code generation proceeds
      this.streamChatStatus("success",
        planSummaryContext,
        { fallback: `Building ${buildPlan.checkpoints.length} components — hang tight!` },
      );

      // ── Backend generation: start in background (non-blocking) ──
      let rustBackendPromise: Promise<boolean> | null = null;
      if (backendCommands.length > 0) {
        this.log("");
        this.log(`── Backend commands planned: ${backendCommands.map(c => c.name).join(", ")} (running in background) ──`);
        rustBackendPromise = this.generateRustBackend(provider, projectId, backendCommands, conversation, systemInfo)
          .catch((err) => {
            this.log(`  Rust backend generation crashed: ${err} — frontend will use try/catch fallbacks.`);
            this.backendSignal = { phase: "failed", turn: this.backendSignal.turn, maxTurns: 50, lastStatus: String(err), success: false, error: String(err) };
            return false;
          });
      }

      onStatus({
        phase: "generating",
        message: `Generating ${buildPlan.checkpoints.length} checkpoint(s)...`,
        filesTotal: totalFiles,
        filesDone: 0,
      });

      // Step 2: Generate files for each checkpoint incrementally
      const previousFiles: Record<string, string> = {};
      let filesDone = 0;

      // We'll build the full GenerationPlan incrementally and use executeCheckpoints
      const fullPlan: GenerationPlan = { filesTotal: totalFiles, checkpoints: [] };
      const manifestCheckpoints: ManifestCheckpoint[] = [];

      for (let cpIdx = 0; cpIdx < buildPlan.checkpoints.length; cpIdx++) {
        if (this.aborted) return;
        const cp = buildPlan.checkpoints[cpIdx];

        this.log("");
        this.log(`── Generating Checkpoint ${cpIdx + 1}/${buildPlan.checkpoints.length}: ${cp.label} ──`);
        this.log(`  Files: ${cp.files.map(f => f.path).join(", ")}`);
        onStatus({
          phase: "generating",
          message: `Generating: ${cp.label}`,
          checkpointLabel: cp.label,
          filesDone,
          filesTotal: totalFiles,
        });
        await flush();

        this.config.onToolStatus?.({ text: `Writing ${cp.files.map(f => f.path.split("/").pop()).join(", ")}...` });
        t0 = Date.now();

        let genResult: { files: Array<{ path: string; content: string }>; rawResponse: string };
        try {
          genResult = await provider.generateCheckpointFiles({
            checkpointLabel: cp.label,
            files: cp.files,
            scaffoldContext: scaffold.promptContext,
            protectedFiles: scaffold.protectedFiles,
            previousFiles: Object.keys(previousFiles).length > 0 ? previousFiles : undefined,
            conversation,
            backendCommands: backendCommands.length > 0 ? backendCommands : undefined,
            systemInfo,
          });
        } catch (cpErr) {
          const errMsg = cpErr instanceof Error ? cpErr.message : String(cpErr);
          this.log(`  [error] Checkpoint "${cp.label}" failed: ${errMsg}`);
          this.config.onToolStatus?.(null);

          // Classify the error for the user
          const isNetwork = /network|connection|timeout|fetch failed|socket|econn/i.test(errMsg);
          const isRateLimit = /429|rate limit|overloaded|quota/i.test(errMsg);
          const isApiKey = /api.?key|auth|unauthorized|403|401/i.test(errMsg);

          let diagnosis: string;
          if (isNetwork) {
            diagnosis = `Network error while generating "${cp.label}". Your internet connection may have dropped during the AI call. All retries were exhausted.`;
          } else if (isRateLimit) {
            diagnosis = `Rate limited by the AI provider while generating "${cp.label}". Too many requests — wait a moment and try again.`;
          } else if (isApiKey) {
            diagnosis = `Authentication error while generating "${cp.label}". Check your API key in Settings.`;
          } else {
            diagnosis = `Failed to generate checkpoint "${cp.label}": ${errMsg}`;
          }

          await this.streamChatStatus("error", diagnosis);
          onStatus({
            phase: "failed",
            error: { title: `Checkpoint failed: ${cp.label}`, detail: diagnosis },
          });
          return;
        }
        if (this.aborted) return;
        this.config.onToolStatus?.(null);

        this.log(`  Generated ${genResult.files.length} file(s) (${elapsed(t0)})`);
        this.log("");
        this.log(`  Raw LLM Response (${genResult.rawResponse.length} chars):`);
        this.log(genResult.rawResponse);
        this.log("");

        // Log full file contents
        for (const f of genResult.files) {
          this.logFileContent(f.path, f.content);
        }

        // Track for next checkpoint's context
        for (const f of genResult.files) {
          previousFiles[f.path] = f.content;
        }

        // Add to full plan for executeCheckpoints
        fullPlan.checkpoints.push({
          id: cp.id,
          label: cp.label,
          files: genResult.files,
        });

        manifestCheckpoints.push({
          id: cp.id,
          label: cp.label,
          files: genResult.files.map((f) => ({ path: f.path, hash: simpleHash(f.content) })),
        });

        filesDone += genResult.files.length;
        await flush();
      }

      // Now execute all checkpoints (stage, apply, validate, self-heal)
      this.config.onToolStatus?.({ text: "Applying files and running checks..." });
      this.manifest = createManifest(projectId, manifestCheckpoints);
      const success = await this.executeCheckpoints(fullPlan);
      if (this.aborted) return;
      if (!success) return;

      // ── Generate source manifest for future edits ──
      try {
        this.log("  Generating source manifest for future edits...");
        this.config.onToolStatus?.({ text: "Indexing project for future edits..." });
        const allSourceFiles = await readProjectSourceFiles(projectId);
        this.sourceManifest = await generateSourceManifest(provider, allSourceFiles);
        this.config.onToolStatus?.(null);
        this.log(`  Manifest ready (${Object.keys(this.sourceManifest.files).length} files)`);
      } catch {
        this.config.onToolStatus?.(null);
        this.log("  Could not generate source manifest (non-fatal)");
      }

      // ── Await background Rust backend if it was started ──
      if (rustBackendPromise) {
        // If already done (finished while frontend was generating), skip waiting
        if (this.backendSignal.phase === "done" || this.backendSignal.phase === "failed") {
          this.log(`  Rust backend already finished (${this.backendSignal.phase}).`);
        } else {
          // Show live progress while waiting — activity-based timeout:
          //   - Absolute max: 5 minutes
          //   - Stall timeout: 90s with no turn advance → give up
          this.log("  Waiting for Rust backend...");
          const ABSOLUTE_TIMEOUT = 300_000; // 5 min absolute max
          const STALL_TIMEOUT = 90_000;     // 90s no progress → stalled
          const waitStart = Date.now();
          let lastSeenTurn = this.backendSignal.turn;
          let lastTurnChangeAt = Date.now();

          const progressInterval = setInterval(() => {
            const sig = this.backendSignal;
            // Track turn advancement for stall detection
            if (sig.turn !== lastSeenTurn) {
              lastSeenTurn = sig.turn;
              lastTurnChangeAt = Date.now();
            }
            const phaseLabel = sig.phase === "compiling" ? "Compiling Rust"
              : sig.phase === "verifying" ? "Verifying commands"
              : `Rust agent turn ${sig.turn}/${sig.maxTurns}`;
            this.config.onToolStatus?.({ text: `${phaseLabel}` });
          }, 500);

          // Wait for completion, stall, or absolute timeout
          const waitResult = await new Promise<"done" | "stalled" | "timeout">((resolve) => {
            const check = () => {
              if (this.backendSignal.phase === "done" || this.backendSignal.phase === "failed") {
                resolve("done");
              } else if (Date.now() - lastTurnChangeAt > STALL_TIMEOUT) {
                resolve("stalled");
              } else if (Date.now() - waitStart > ABSOLUTE_TIMEOUT) {
                resolve("timeout");
              } else {
                setTimeout(check, 300);
              }
            };
            check();
          });

          clearInterval(progressInterval);

          if (waitResult !== "done") {
            const reason = waitResult === "stalled"
              ? `no progress for ${Math.round(STALL_TIMEOUT / 1000)}s (stuck on turn ${this.backendSignal.turn})`
              : `exceeded ${Math.round(ABSOLUTE_TIMEOUT / 1000)}s absolute limit`;
            this.log(`  ⚠ Rust backend wait ended: ${reason}. Continuing — agent is still running in background.`);

            // Keep a background listener so the result is logged when it eventually finishes
            rustBackendPromise.then((success) => {
              if (success) {
                this.log("  ✓ Rust backend finished compiling (after frontend moved on) — commands are ready.");
              } else {
                this.log("  ✗ Rust backend failed (after frontend moved on) — OS commands will not work.");
              }
            }).catch(() => {
              // already handled in the .catch wrapper above
            });
          }
        }

        this.config.onToolStatus?.(null);
        if (this.backendSignal.success) {
          this.log("  ✓ Rust backend compiled successfully — commands are ready.");
        } else if (this.backendSignal.phase === "done" || this.backendSignal.phase === "failed") {
          this.log(`  ✗ Rust backend did not compile — OS commands will use try/catch fallbacks at runtime.${this.backendSignal.error ? ` (${this.backendSignal.error})` : ""}`);
        } else {
          this.log("  ⏳ Rust backend still running in background — result will appear in log when it finishes.");
        }
      }

      // ── Done ──
      this.log("");
      this.log("── Generation Complete ──");
      this.log("  All checkpoints applied successfully. Preview is ready.");
      await this.streamChatStatus("success", `Build complete — all ${buildPlan.checkpoints.length} checkpoints applied successfully and the preview is ready.`);
      onStatus({
        phase: "ready",
        message: "Preview is ready",
        filesDone: totalFiles,
        filesTotal: totalFiles,
      });
    } catch (err) {
      if (this.aborted) return;
      const detail = err instanceof Error ? err.message : String(err);
      this.log(`[error] Generation failed: ${detail}`);
      if (err instanceof Error && err.stack) {
        this.log(`[error] Stack: ${err.stack}`);
      }

      // Classify the error for a helpful user-facing message
      const lower = detail.toLowerCase();
      const isNetwork = /network|connection|timeout|fetch failed|socket|econn/i.test(lower);
      const isRateLimit = /429|rate limit|overloaded|quota/i.test(lower);
      const isApiKey = /api.?key|auth|unauthorized|403|401/i.test(lower);
      const isParse = /parse|json|could not generate|could not parse/i.test(lower);

      let userMessage: string;
      if (isNetwork) {
        userMessage = `Generation failed due to a network error: ${detail}. Check your internet connection and try again.`;
      } else if (isRateLimit) {
        userMessage = `The AI provider is rate-limiting requests. Wait a moment and try again. (${detail})`;
      } else if (isApiKey) {
        userMessage = `Authentication failed — check your API key in Settings. (${detail})`;
      } else if (isParse) {
        userMessage = `The AI returned an invalid response that couldn't be parsed. Try again — this is usually transient. (${detail})`;
      } else {
        userMessage = `Generation failed with an unexpected error: ${detail}`;
      }

      await this.streamChatStatus("error", userMessage);
      onStatus({
        phase: "failed",
        error: {
          title: "Generation failed",
          detail: userMessage,
        },
      });
    }
  }

  private async executeCheckpoints(plan: GenerationPlan): Promise<boolean> {
    const { projectId, onStatus } = this.config;
    const genId = this.manifest!.genId;
    const totalFiles = plan.filesTotal;
    let filesDone = 0;

    for (const cp of plan.checkpoints) {
      if (this.aborted) return false;
      this.totalCheckpointsProcessed++;
      if (this.totalCheckpointsProcessed > MAX_CHECKPOINTS) {
        onStatus({
          phase: "failed",
          error: { title: "Too many checkpoints", detail: `Stopped after ${MAX_CHECKPOINTS} checkpoints.` },
        });
        return false;
      }

      // Stage
      this.log("");
      this.log(`── Checkpoint: ${cp.label} ──`);
      this.log(`  Staging ${cp.files.length} file(s)...`);
      onStatus({
        phase: "staging",
        message: `Staging ${cp.label}...`,
        checkpointLabel: cp.label,
        filesDone,
        filesTotal: totalFiles,
      });
      let cpT0 = Date.now();
      await stageFiles(projectId, genId, cp.files);
      filesDone += cp.files.length;
      for (const f of cp.files) {
        this.log(`  ✓ staged ${f.path}`);
      }
      this.log(`  Staging done (${elapsed(cpT0)})`);
      await flush();
      if (this.aborted) return false;

      // Apply
      this.log(`  Applying checkpoint...`);
      onStatus({
        phase: "checkpoint",
        message: `Applying: ${cp.label}`,
        checkpointLabel: cp.label,
        filesDone,
        filesTotal: totalFiles,
      });
      cpT0 = Date.now();
      const filePaths = cp.files.map((f) => f.path);
      const result = await applyCheckpoint(projectId, genId, filePaths);
      const snapshotId = result.snapshot_id;
      this.log(`  Applied → snapshot ${snapshotId} (${elapsed(cpT0)})`);

      // Register snapshot in history immediately so undo always targets
      // this checkpoint (not a previous one).
      this.appliedSnapshots.push(snapshotId);
      this.config.onSnapshotApplied?.(snapshotId);
      if (!this.firstCheckpointDone) {
        this.firstCheckpointDone = true;
        this.config.onFirstCheckpointApplied?.();
      }

      await flush();
      if (this.aborted) return false;

      // Re-install deps if package.json was in this checkpoint
      if (filePaths.some((p) => p === "package.json" || p.endsWith("/package.json"))) {
        this.depsInstalled = false;
      }
      this.config.onToolStatus?.({ text: "Installing dependencies..." });
      cpT0 = Date.now();
      await this.ensureDepsInstalled(projectId);
      this.log(`  Dependencies check (${elapsed(cpT0)})`);
      this.config.onToolStatus?.(null);
      if (this.aborted) return false;

      // Validate
      this.log(`  Validating TypeScript...`);
      this.config.onToolStatus?.({ text: "Running TypeScript type checker..." });
      onStatus({
        phase: "validating",
        message: `Validating ${cp.label}...`,
        checkpointLabel: cp.label,
        filesDone,
        filesTotal: totalFiles,
      });
      cpT0 = Date.now();
      const validation = await runValidation(projectId, ["npx tsc --noEmit"]);
      this.config.onToolStatus?.(null);
      this.log(`  Validation done (${elapsed(cpT0)})`);
      await flush();
      if (this.aborted) return false;

      if (!validation.ok) {
        this.log(`  ✗ Validation FAILED (exit ${validation.exit_code}) — entering self-heal...`);
        if (validation.stdout_tail.length > 0) {
          this.log(`  stdout:`);
          for (const line of validation.stdout_tail) {
            this.log(`    ${line}`);
          }
        }
        if (validation.stderr_tail.length > 0) {
          this.log(`  stderr:`);
          for (const line of validation.stderr_tail) {
            this.log(`    ${line}`);
          }
        }

        // Don't rollback yet — let the fixer see the broken code on disk.
        // Only rollback the original snapshot if all fix attempts fail.
        const healed = await this.selfHealLoop(
          cp.label,
          validation.stdout_tail,
          validation.stderr_tail,
          filePaths,
          snapshotId,
          filesDone,
          totalFiles,
        );

        if (!healed) {
          // selfHealLoop rolled back files; adjust cursor to match
          this.config.onSnapshotRolledBack?.(1);
          return false;
        }
      } else {
        this.log(`  ✓ Validation passed`);

        // Check runtime console errors from the iframe (if available)
        // Wait briefly for the preview to render and report any errors
        if (this.config.getRuntimeErrors) {
          await new Promise((r) => setTimeout(r, 2000));
          const rtErrors = this.config.getRuntimeErrors();
          const significantErrors = rtErrors.filter((e) =>
            e.startsWith("[error]") && !e.includes("Could not connect to the server")
          );
          if (significantErrors.length > 0) {
            this.log(`  ⚠ Runtime console errors detected (${significantErrors.length}):`);
            for (const e of significantErrors.slice(0, 20)) {
              this.log(`    ${e}`);
            }

            // Feed runtime errors into self-heal loop
            this.log(`  Entering self-heal for runtime errors...`);
            const healed = await this.selfHealLoop(
              cp.label,
              significantErrors,
              [],
              filePaths,
              snapshotId,
              filesDone,
              totalFiles,
            );

            if (!healed) {
              this.log(`  Could not fix runtime errors — continuing anyway (app may have issues).`);
              // Don't fail the build for runtime errors — tsc passed, so the app compiles.
              // Just log the warning and move on.
            }
          }
        }
      }
    }

    return true;
  }

  /**
   * Diagnostic-driven self-heal — inspired by Claude Code's approach.
   *
   * Instead of a blind retry loop, each iteration is two AI phases:
   *   1. INVESTIGATE: AI sees diagnostics and requests context (grep patterns,
   *      file reads, line ranges) — like Claude Code using Grep/Read tools.
   *   2. FIX: AI sees gathered context + diagnostics and produces patches.
   *
   * Fixes accumulate (no per-attempt rollback). If all attempts fail, rollback everything.
   */
  private async selfHealLoop(
    failedLabel: string,
    stdoutTail: string[],
    stderrTail: string[],
    changedFiles: string[],
    originalSnapshotId: string,
    filesDone: number,
    filesTotal: number,
  ): Promise<boolean> {
    const { provider, projectId, onStatus } = this.config;
    const genId = this.manifest!.genId;

    let currentStdout = stdoutTail;
    let currentStderr = stderrTail;
    const fixSnapshots: string[] = []; // track fix snapshots for bulk rollback
    const previousInvestigations: Array<{ diagnostics: Diagnostic[]; investigationSummary: string; fixLabel: string; remainingErrors: number }> = [];
    const previousFixes: Array<{ fixLabel: string; patchSummary: string; resultingErrors: number }> = [];

    // Get project file listing once (for investigation context)
    const projectFiles = await this.getProjectFileList(projectId);
    this.log(`[fix] Project has ${projectFiles.length} source files`);

    for (let attempt = 1; attempt <= MAX_FIX_ITERS; attempt++) {
      if (this.aborted) return false;

      const fixAttemptT0 = Date.now();

      // ── Parse diagnostics ──
      const diagnostics = parseTscErrors([...currentStdout, ...currentStderr]);
      this.log(`[fix] Attempt ${attempt}/${MAX_FIX_ITERS} — ${diagnostics.length} diagnostic(s)`);
      onStatus({
        phase: "investigating",
        message: `Investigating errors (attempt ${attempt}/${MAX_FIX_ITERS})`,
        checkpointLabel: failedLabel,
        fixAttempt: attempt,
        fixMaxAttempts: MAX_FIX_ITERS,
        filesDone,
        filesTotal,
      });
      await flush();

      if (diagnostics.length === 0) {
        // Can't parse structured errors — fall back to broad proposeFix
        this.log(`[fix] No structured diagnostics — falling back to broad fix`);
        const broadResult = await this.broadFixFallback(provider, projectId, failedLabel, currentStdout, currentStderr, changedFiles);
        if (!broadResult) {
          if (attempt === MAX_FIX_ITERS) break;
          continue;
        }
        // broadResult has patches — proceed to apply below
        // (but we need the fix pipeline, so let's use the investigation pipeline with empty investigation)
      }

      // ── Auto-read all erroring files (the AI MUST see file content to produce patches) ──
      let investigationContext: InvestigationContext = { fileContents: {}, lineExtracts: {}, searchResults: {} };
      const errorFiles = new Set(diagnostics.map(d => d.file));
      for (const filePath of errorFiles) {
        try {
          investigationContext.fileContents[filePath] = await readProjectFile(projectId, filePath);
        } catch {
          this.log(`[fix] Could not read erroring file ${filePath}`);
        }
      }
      this.log(`[fix] Auto-read ${Object.keys(investigationContext.fileContents).length} erroring file(s): ${[...errorFiles].join(", ")}`);

      // ── Phase 1: INVESTIGATE — AI requests additional context (type defs, related files) ──
      if (diagnostics.length > 0) {
        this.log(`[fix] Phase 1: Asking AI what additional context it needs...`);
        this.config.onToolStatus?.({ text: `Diagnosing ${diagnostics.length} error(s)...` });
        const investT0 = Date.now();
        const investResult = await provider.investigateErrors({
          diagnostics,
          changedFiles,
          projectFiles,
          previousAttempts: previousInvestigations.length > 0 ? previousInvestigations : undefined,
        });
        if (this.aborted) return false;

        const plan = investResult.plan;
        this.log(`[fix] Investigation plan (${elapsed(investT0)}): ${plan.reasoning}`);
        this.log(`[fix] Requests: ${plan.requests.length} (${plan.requests.map(r => r.readFile ? `read:${r.readFile}` : r.readLines ? `lines:${r.readLines.file}` : r.searchPattern ? `grep:"${r.searchPattern.pattern}"` : '?').join(', ')})`);

        // Execute the AI's investigation requests and merge into context
        if (plan.requests.length > 0) {
          const extra = await this.executeInvestigation(projectId, plan);
          // Merge — don't overwrite already-read erroring files
          for (const [k, v] of Object.entries(extra.fileContents)) {
            if (!investigationContext.fileContents[k]) investigationContext.fileContents[k] = v;
          }
          Object.assign(investigationContext.lineExtracts, extra.lineExtracts);
          Object.assign(investigationContext.searchResults, extra.searchResults);

          const ctxFiles = Object.keys(investigationContext.fileContents).length;
          const ctxLines = Object.keys(investigationContext.lineExtracts).length;
          const ctxSearches = Object.keys(investigationContext.searchResults).length;
          this.log(`[fix] Total context: ${ctxFiles} file(s), ${ctxLines} line extract(s), ${ctxSearches} search(es)`);
        }
      }

      // ── Phase 2: FIX — AI produces patches (it now has all erroring files + investigation context) ──
      this.log(`[fix] Phase 2: Asking AI for patches...`);
      this.config.onToolStatus?.({ text: "Writing patches to fix errors..." });
      onStatus({
        phase: "fixing",
        message: `Generating fix (attempt ${attempt}/${MAX_FIX_ITERS})`,
        checkpointLabel: failedLabel,
        fixAttempt: attempt,
        fixMaxAttempts: MAX_FIX_ITERS,
        filesDone,
        filesTotal,
      });

      const fixT0 = Date.now();
      const fixResult = await provider.diagnosticFix({
        diagnostics,
        investigationContext,
        changedFiles,
        previousAttempts: previousFixes.length > 0 ? previousFixes : undefined,
      });
      if (this.aborted) return false;

      this.config.onToolStatus?.(null);
      const fixPlan = fixResult.plan;
      this.log(`[fix] Fix plan (${elapsed(fixT0)}): "${fixPlan.label}" — ${fixPlan.patches.length} patch(es)`);

      if (fixPlan.patches.length === 0) {
        this.log(`[fix] AI returned no patches — attempt ${attempt} failed`);
        previousInvestigations.push({
          diagnostics,
          investigationSummary: `${Object.keys(investigationContext.fileContents).length} files, ${Object.keys(investigationContext.searchResults).length} searches`,
          fixLabel: "(empty)",
          remainingErrors: diagnostics.length,
        });
        if (attempt === MAX_FIX_ITERS) break;
        continue;
      }

      // ── Log patches ──
      this.log("");
      const patchesByFile = new Map<string, typeof fixPlan.patches>();
      for (const patch of fixPlan.patches) {
        const existing = patchesByFile.get(patch.path) ?? [];
        existing.push(patch);
        patchesByFile.set(patch.path, existing);
      }
      for (const [filePath, patches] of patchesByFile) {
        this.log(`  ┌── ${filePath} (${patches.length} patch${patches.length > 1 ? "es" : ""}) ──`);
        for (let i = 0; i < patches.length; i++) {
          const patch = patches[i];
          this.log(`  │  SEARCH (${patch.old.split("\n").length} lines):`);
          for (const line of patch.old.split("\n")) this.log(`  │  - ${line}`);
          this.log(`  │  REPLACE (${patch.new.split("\n").length} lines):`);
          for (const line of patch.new.split("\n")) this.log(`  │  + ${line}`);
        }
        this.log(`  └── end ${filePath} ──`);
      }
      this.log("");

      // ── Phase 4: APPLY patches ──
      const fixedFiles: Array<{ path: string; content: string }> = [];
      let patchFailed = false;

      for (const patch of fixPlan.patches) {
        let currentContent: string;
        const alreadyPatched = fixedFiles.find((f) => f.path === patch.path);
        if (alreadyPatched) {
          currentContent = alreadyPatched.content;
        } else {
          try {
            currentContent = await readProjectFile(projectId, patch.path);
          } catch {
            this.log(`  ✗ Cannot read ${patch.path} — skipping patch`);
            continue;
          }
        }

        try {
          const result = replaceBlock(currentContent, patch.old, patch.new);
          this.log(`  ✓ ${patch.path} (strategy: ${result.strategy})`);
          if (alreadyPatched) {
            alreadyPatched.content = result.updated;
          } else {
            fixedFiles.push({ path: patch.path, content: result.updated });
          }
        } catch (err) {
          if (err instanceof NotFound) {
            this.log(`  ✗ NotFound in ${patch.path}`);
          } else if (err instanceof AmbiguousMatch) {
            this.log(`  ✗ AmbiguousMatch in ${patch.path}`);
          } else {
            this.log(`  ✗ Error in ${patch.path}: ${err}`);
          }
          patchFailed = true;
          break;
        }
      }

      if (patchFailed || fixedFiles.length === 0) {
        this.log(`[fix] Patch application failed — continuing to next attempt`);
        const patchSummary = fixPlan.patches.map(p => `${p.path}`).join(", ");
        previousFixes.push({ fixLabel: fixPlan.label, patchSummary, resultingErrors: diagnostics.length });
        previousInvestigations.push({
          diagnostics,
          investigationSummary: `${Object.keys(investigationContext.fileContents).length} files, ${Object.keys(investigationContext.searchResults).length} searches`,
          fixLabel: fixPlan.label,
          remainingErrors: diagnostics.length,
        });
        continue;
      }

      // ── Stage + apply (creates snapshot for rollback safety) ──
      this.totalCheckpointsProcessed++;
      if (this.totalCheckpointsProcessed > MAX_CHECKPOINTS) {
        this.log(`[fix] Too many checkpoints — rolling back`);
        for (const sid of fixSnapshots.reverse()) await rollbackSnapshot(projectId, sid);
        await rollbackSnapshot(projectId, originalSnapshotId);
        if (fixSnapshots.length > 0) {
          this.config.onSnapshotRolledBack?.(fixSnapshots.length);
        }
        onStatus({ phase: "failed", error: { title: "Too many checkpoints", detail: `Stopped after ${MAX_CHECKPOINTS} total.` } });
        return false;
      }

      onStatus({ phase: "staging", message: `Staging fix: ${fixPlan.label}`, checkpointLabel: fixPlan.label, fixAttempt: attempt, fixMaxAttempts: MAX_FIX_ITERS, filesDone, filesTotal });
      let t0 = Date.now();
      await stageFiles(projectId, genId, fixedFiles);
      this.log(`[fix-stage] Staged (${elapsed(t0)})`);
      if (this.aborted) return false;

      onStatus({ phase: "checkpoint", message: `Applying fix: ${fixPlan.label}`, checkpointLabel: fixPlan.label, fixAttempt: attempt, fixMaxAttempts: MAX_FIX_ITERS, filesDone, filesTotal });
      t0 = Date.now();
      const fixFilePaths = fixedFiles.map((f) => f.path);
      const fixApplyResult = await applyCheckpoint(projectId, genId, fixFilePaths);
      fixSnapshots.push(fixApplyResult.snapshot_id);
      this.log(`[fix-apply] Applied (${elapsed(t0)})`);

      // Register fix snapshot in history immediately
      this.appliedSnapshots.push(fixApplyResult.snapshot_id);
      this.config.onSnapshotApplied?.(fixApplyResult.snapshot_id);

      if (this.aborted) return false;

      // Re-install deps if package.json changed
      if (fixFilePaths.some((p) => p === "package.json" || p.endsWith("/package.json"))) {
        this.depsInstalled = false;
      }
      t0 = Date.now();
      await this.ensureDepsInstalled(projectId);
      this.log(`[fix-deps] Deps (${elapsed(t0)})`);
      if (this.aborted) return false;

      // Update changedFiles to include newly patched files
      for (const fp of fixFilePaths) {
        if (!changedFiles.includes(fp)) changedFiles.push(fp);
      }

      // ── Phase 5: RE-DIAGNOSE ──
      onStatus({ phase: "validating", message: `Validating fix: ${fixPlan.label}`, checkpointLabel: fixPlan.label, fixAttempt: attempt, fixMaxAttempts: MAX_FIX_ITERS, filesDone, filesTotal });
      t0 = Date.now();
      const fixValidation = await runValidation(projectId, ["npx tsc --noEmit"]);
      this.log(`[fix-validate] Done (${elapsed(t0)})`);
      await flush();
      if (this.aborted) return false;

      if (fixValidation.ok) {
        this.log(`[fix-validate] PASSED ✓ — all errors resolved (${elapsed(fixAttemptT0)})`);
        // Fix snapshots were already registered in history above
        return true;
      }

      // Still errors — log and continue to next attempt with new diagnostics
      const newErrors = parseTscErrors([...fixValidation.stdout_tail, ...fixValidation.stderr_tail]);
      this.log(`[fix-validate] FAILED — ${newErrors.length} error(s) remain (was ${diagnostics.length})`);
      if (fixValidation.stdout_tail.length > 0) {
        for (const line of fixValidation.stdout_tail.slice(-10)) this.log(`  ${line}`);
      }

      // Record this attempt for history
      const patchSummary = fixPlan.patches.map(p => `${p.path}`).join(", ");
      previousFixes.push({ fixLabel: fixPlan.label, patchSummary, resultingErrors: newErrors.length });
      previousInvestigations.push({
        diagnostics,
        investigationSummary: `${Object.keys(investigationContext.fileContents).length} files, ${Object.keys(investigationContext.searchResults).length} searches`,
        fixLabel: fixPlan.label,
        remainingErrors: newErrors.length,
      });

      // Feed new errors into next iteration (NO rollback — fixes accumulate)
      currentStdout = fixValidation.stdout_tail;
      currentStderr = fixValidation.stderr_tail;
    }

    // All attempts exhausted — rollback everything (fix snapshots + original)
    this.log(`[fix] Exhausted all ${MAX_FIX_ITERS} attempts — rolling back`);
    await this.streamChatStatus("error", `Tried ${MAX_FIX_ITERS} times to fix the TypeScript errors in "${failedLabel}" but couldn't resolve them. Rolling back all changes.`);
    for (const sid of fixSnapshots.reverse()) {
      await rollbackSnapshot(projectId, sid);
    }
    await rollbackSnapshot(projectId, originalSnapshotId);
    // Adjust cursor: fix snapshots were registered in history; roll them back
    if (fixSnapshots.length > 0) {
      this.config.onSnapshotRolledBack?.(fixSnapshots.length);
    }
    onStatus({
      phase: "failed",
      error: { title: `Self-heal exhausted: ${failedLabel}`, detail: `Failed after ${MAX_FIX_ITERS} fix attempts. TypeScript errors persist.` },
      validationLogs: { stdout: currentStdout, stderr: currentStderr },
      rolledBack: true,
      fixAttempt: MAX_FIX_ITERS,
      fixMaxAttempts: MAX_FIX_ITERS,
    });
    return false;
  }

  /** Execute the AI's investigation requests — read files, extract lines, grep patterns. */
  private async executeInvestigation(
    projectId: string,
    plan: InvestigationPlan,
  ): Promise<InvestigationContext> {
    const result: InvestigationContext = { fileContents: {}, lineExtracts: {}, searchResults: {} };

    for (const req of plan.requests) {
      if (req.readFile) {
        try {
          result.fileContents[req.readFile] = await readProjectFile(projectId, req.readFile);
          this.log(`  [investigate] Read ${req.readFile}`);
        } catch {
          this.log(`  [investigate] Could not read ${req.readFile}`);
        }
      }

      if (req.readLines) {
        try {
          const content = await readProjectFile(projectId, req.readLines.file);
          const lines = content.split("\n");
          const start = Math.max(0, req.readLines.startLine - 1);
          const end = Math.min(lines.length, req.readLines.endLine);
          const key = `${req.readLines.file}:${req.readLines.startLine}-${req.readLines.endLine}`;
          result.lineExtracts[key] = lines.slice(start, end)
            .map((l, i) => `${start + i + 1}: ${l}`)
            .join("\n");
          this.log(`  [investigate] Lines ${req.readLines.startLine}-${req.readLines.endLine} of ${req.readLines.file}`);
        } catch {
          this.log(`  [investigate] Could not read lines from ${req.readLines.file}`);
        }
      }

      if (req.searchPattern) {
        try {
          const matches = await grepProjectFiles(projectId, req.searchPattern.pattern, req.searchPattern.fileGlob, 20);
          result.searchResults[req.searchPattern.pattern] = matches;
          this.log(`  [investigate] Grep "${req.searchPattern.pattern}" → ${matches.length} match(es)`);
        } catch {
          this.log(`  [investigate] Grep failed for "${req.searchPattern.pattern}"`);
        }
      }
    }

    return result;
  }

  /** List all source files in the project (for investigation context). */
  private async getProjectFileList(projectId: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: DirEntry[];
      try {
        entries = await listDir(projectId, dir);
      } catch { return; }

      for (const entry of entries) {
        const fullPath = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.is_dir) {
          if (entry.name !== "node_modules" && entry.name !== ".rain" && entry.name !== "dist" && entry.name !== "target") {
            await walk(fullPath);
          }
        } else if (/\.(tsx?|css|json|rs)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    await walk("src");
    // Walk Rust backend sources
    await walk("src-tauri/src");
    // Also include root config files
    try {
      const rootEntries = await listDir(projectId, "");
      for (const entry of rootEntries) {
        if (!entry.is_dir && /\.(tsx?|json|toml)$/.test(entry.name)) {
          files.push(entry.name);
        }
      }
    } catch { /* no root files */ }

    return files;
  }

  /** Fallback: old-style broad fix when errors can't be parsed into structured diagnostics. */
  private async broadFixFallback(
    provider: AiProvider,
    projectId: string,
    failedLabel: string,
    stdoutTail: string[],
    stderrTail: string[],
    changedFiles: string[],
  ): Promise<{ plan: { label: string; patches: Array<{ path: string; old: string; new: string }> } } | null> {
    const filesToRead = new Set(changedFiles);
    const rawText = [...stdoutTail, ...stderrTail].join("\n");
    const fileRefPattern = /(?:^|\s)(src\/[^\s:()"]+\.tsx?)/g;
    let match;
    while ((match = fileRefPattern.exec(rawText)) !== null) {
      filesToRead.add(match[1]);
    }

    const fileContents: Record<string, string> = {};
    for (const filePath of filesToRead) {
      try {
        fileContents[filePath] = await readProjectFile(projectId, filePath);
      } catch { /* skip */ }
    }

    const result = await provider.proposeFix({
      messages: this.config.messages,
      failedCheckpointLabel: failedLabel,
      stdoutTail,
      stderrTail,
      changedFiles,
      lastPlanSummary: "",
      fileContents,
    });

    return result.plan.patches.length > 0 ? result : null;
  }

  // ── Rust Backend Generation ──────────────────────────────────────

  /**
   * Generate initial Rust code via AI, then hand off to the Rust agent loop
   * which can read files, edit them, run cargo check, and iterate until
   * the backend compiles and passes semantic review.
   */
  private async generateRustBackend(
    provider: AiProvider,
    projectId: string,
    commands: BackendCommand[],
    conversation: string,
    systemInfo?: { os: string; arch: string; home_dir: string; desktop_dir: string; documents_dir: string; downloads_dir: string },
  ): Promise<boolean> {
    this.log("");
    this.log("── Generating Rust Backend ──");
    this.log(`  Commands: ${commands.map(c => c.name).join(", ")}`);
    if (systemInfo) {
      this.log(`  Target: ${systemInfo.os} (${systemInfo.arch})`);
      this.log(`  Home: ${systemInfo.home_dir}`);
      this.log(`  Desktop: ${systemInfo.desktop_dir}`);
      this.log(`  Documents: ${systemInfo.documents_dir}`);
      this.log(`  Downloads: ${systemInfo.downloads_dir}`);
    } else {
      this.log(`  ⚠ No system info available — AI will use generic defaults`);
    }

    this.config.onToolStatus?.({ text: "Generating Rust backend commands..." });
    let t0 = Date.now();

    // Step 1: Generate initial Rust code
    const genPrompt = buildGenerateRustBackend({ conversation, commands, systemInfo });
    const genRaw = await provider.rawGenerate({
      system: genPrompt.system,
      user: genPrompt.user,
      json: true,
      model: "pro",
    });
    if (this.aborted) return false;

    const genResult = parseJson<{
      commandsRs: string;
      libRs?: string;
      mainRs: string;
      cargoToml?: string;
    }>(genRaw);

    if (!genResult?.commandsRs) {
      this.log("  ERROR: AI returned invalid Rust backend code (no commandsRs)");
      this.config.onToolStatus?.(null);
      return false;
    }

    // Build the correct Tauri 2 lib.rs + main.rs pattern
    // If AI returned libRs, use it. Otherwise construct from mainRs or default.
    const libRs = genResult.libRs || (genResult.mainRs?.includes("pub fn run()") ? genResult.mainRs : `mod commands;\n\npub fn run() {\n    tauri::Builder::default()\n        .invoke_handler(tauri::generate_handler![\n            ${commands.map(c => `commands::${c.name}`).join(",\n            ")},\n        ])\n        .run(tauri::generate_context!())\n        .expect("error while running tauri application");\n}\n`);
    const mainRs = genResult.mainRs?.includes("generated_app_lib::run()")
      ? genResult.mainRs
      : `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    generated_app_lib::run();\n}\n`;

    const defaultCargoToml = `[package]\nname = "generated-app"\nversion = "1.0.0"\nedition = "2021"\n\n[lib]\nname = "generated_app_lib"\ncrate-type = ["staticlib", "cdylib", "rlib"]\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`;

    this.log(`  Generated initial Rust code (${elapsed(t0)})`);
    this.log("");
    this.log("  ── commands.rs ──");
    this.log(genResult.commandsRs);
    this.log("  ── lib.rs ──");
    this.log(libRs);
    this.log("  ── main.rs ──");
    this.log(mainRs);

    // Step 2: Hand off to Rust agent loop for compilation + fixing
    const commandSpecs = commands.map((cmd) => {
      const argsStr = cmd.args.map((a) => `  - ${a.name}: ${a.rustType} — ${a.description}`).join("\n");
      return `Command: ${cmd.name}\n  Description: ${cmd.description}\n  Args:\n${argsStr}\n  Returns: ${cmd.returnType}`;
    }).join("\n\n");

    t0 = Date.now();
    const sysInfoStr = systemInfo
      ? `OS: ${systemInfo.os} (${systemInfo.arch})\nHome: ${systemInfo.home_dir}\nDesktop: ${systemInfo.desktop_dir}\nDocuments: ${systemInfo.documents_dir}\nDownloads: ${systemInfo.downloads_dir}`
      : undefined;

    this.backendSignal = { phase: "generating", turn: 0, maxTurns: 50, lastStatus: "Starting Rust agent...", success: false };

    const result = await runRustAgentLoop({
      projectId,
      initialFiles: {
        commandsRs: genResult.commandsRs,
        mainRs,
        libRs,
        cargoToml: genResult.cargoToml || defaultCargoToml,
      },
      commandSpecs,
      conversation,
      systemInfo: sysInfoStr,
      generate: (system, user) => provider.rawGenerate({ system, user, json: true, model: "pro" }),
      onStatus: (text) => {
        this.backendSignal.lastStatus = text;
        // Detect phase from status text
        if (/cargo.check|compil/i.test(text)) this.backendSignal.phase = "compiling";
        else if (/verif/i.test(text)) this.backendSignal.phase = "verifying";
        else this.backendSignal.phase = "generating";
      },
      onLog: (line) => {
        this.log(line);
        // Track turn number from log output
        const turnMatch = line.match(/Rust Agent Turn (\d+)/);
        if (turnMatch) this.backendSignal.turn = parseInt(turnMatch[1], 10);
      },
      isAborted: () => this.aborted,
    });

    this.backendSignal = {
      phase: result.success ? "done" : "failed",
      turn: this.backendSignal.turn,
      maxTurns: 50,
      lastStatus: result.message,
      success: result.success,
      error: result.success ? undefined : result.message,
    };

    this.log(`  Rust agent loop finished (${elapsed(t0)}) — ${result.success ? "SUCCESS" : "FAILED"}`);

    if (!result.success) {
      this.log("  WARNING: Rust backend did not compile — frontend will still work but OS commands will fail at runtime.");
    }

    return result.success;
  }
}

function simpleHash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ── TypeScript error parsing ──

/** Parse structured diagnostics from tsc output lines. */
function parseTscErrors(lines: string[]): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/;
  for (const line of lines) {
    const m = pattern.exec(line.trim());
    if (m) {
      errors.push({ file: m[1], line: +m[2], col: +m[3], code: m[4], message: m[5] });
    }
  }
  return errors;
}
