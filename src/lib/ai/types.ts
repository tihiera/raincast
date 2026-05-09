import type { ChatMessage } from "../chat/types";
import type { LayoutArchetype } from "../generation/templates";

export type AiProviderId = "gemini" | "anthropic" | "openai" | "anthropic-compatible";

export type QueryIntent = "chat" | "build_app" | "edit_app" | "generate_logo" | "unsupported";

export interface QueryDecision {
  intent: QueryIntent;
  confidence: number;
  summary: string;
  message: string;
  /** Layout archetype chosen by the LLM (only meaningful when intent is "build_app"). */
  layoutArchetype?: LayoutArchetype;
  /** Whether the app needs OS-level backend commands (file I/O, shell, etc.). */
  needsBackend?: boolean;
}

export interface GenerationPlan {
  filesTotal: number;
  checkpoints: Array<{
    id: string;
    label: string;
    files: Array<{ path: string; content: string }>;
  }>;
}

/** A Rust backend command the AI wants to expose to the frontend. */
export interface BackendCommand {
  /** Rust function name — snake_case, e.g. "list_documents" */
  name: string;
  /** What this command does and why it needs backend access */
  description: string;
  /** Argument fields the frontend sends (name + Rust type + description) */
  args: Array<{ name: string; rustType: string; description: string }>;
  /** Rust return type, e.g. "Vec<String>", "String", "()" */
  returnType: string;
  /** Extra crates needed beyond tauri/serde/serde_json, e.g. ["walkdir"] */
  extraCrates?: string[];
}

/** Window configuration chosen by the AI based on app type. */
export interface WindowConfig {
  /** Window width in pixels (e.g. 400 for a utility, 1200 for a dashboard). */
  width: number;
  /** Window height in pixels (e.g. 300 for a widget, 800 for a full app). */
  height: number;
}

/** Lightweight build plan — just structure, no code content. */
export interface BuildPlan {
  checkpoints: Array<{
    id: string;
    label: string;
    files: Array<{ path: string; description: string }>;
  }>;
  /** Rust backend commands needed for OS/system interaction. */
  backendCommands?: BackendCommand[];
  /** Window size — the AI chooses dimensions that fit the app's purpose. */
  window?: WindowConfig;
}

/** Files generated for a single checkpoint. */
export interface CheckpointFiles {
  files: Array<{ path: string; content: string }>;
}

/** A single search/replace patch — the AI returns only the changed portion. */
export interface FixPatch {
  path: string;
  old: string;
  new: string;
}

/** Contains surgical search/replace patches instead of full files. Used for edits and self-heal. */
export interface FixPlan {
  label: string;
  patches: FixPatch[];
}

/** A single edit task identified in the planning step. */
export interface EditTask {
  file: string;
  description: string;
}

/** The result of the planning step — what needs to change and where. */
export interface EditPlan {
  label: string;
  tasks: EditTask[];
}

export interface ProposFixArgs {
  messages: ChatMessage[];
  failedCheckpointLabel: string;
  stdoutTail: string[];
  stderrTail: string[];
  changedFiles: string[];
  lastPlanSummary: string;
  /** Current on-disk contents of relevant files so the fixer can see what it's working with. */
  fileContents: Record<string, string>;
}

// ── Diagnostic-driven self-heal types ──

/** Structured TypeScript diagnostic from tsc output. */
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

/** A request from the AI to investigate context before fixing. */
export interface InvestigationRequest {
  readFile?: string;
  readLines?: { file: string; startLine: number; endLine: number };
  searchPattern?: { pattern: string; fileGlob?: string };
}

/** The AI's investigation plan — what context it needs to understand errors. */
export interface InvestigationPlan {
  reasoning: string;
  requests: InvestigationRequest[];
}

/** Context gathered by executing investigation requests. */
export interface InvestigationContext {
  fileContents: Record<string, string>;
  lineExtracts: Record<string, string>;
  searchResults: Record<string, Array<{ file: string; line: number; text: string }>>;
}

/** Arguments for the investigation phase. */
export interface InvestigateErrorsArgs {
  diagnostics: Diagnostic[];
  changedFiles: string[];
  projectFiles: string[];
  previousAttempts?: Array<{
    diagnostics: Diagnostic[];
    investigationSummary: string;
    fixLabel: string;
    remainingErrors: number;
  }>;
}

/** Arguments for the diagnostic fix phase. */
export interface DiagnosticFixArgs {
  diagnostics: Diagnostic[];
  investigationContext: InvestigationContext;
  changedFiles: string[];
  previousAttempts?: Array<{
    fixLabel: string;
    patchSummary: string;
    resultingErrors: number;
  }>;
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  supportsImages: boolean;
  analyzeQuery(args: { messages: ChatMessage[]; hasProject: boolean }): Promise<QueryDecision>;
  chatRespond(args: { messages: ChatMessage[] }): Promise<string>;
  chatRespondStream(args: { messages: ChatMessage[]; onChunk: (text: string) => void }): Promise<void>;
  generatePlan(args: {
    messages: ChatMessage[];
    mode: "build" | "edit";
    scaffoldContext?: string;
    protectedFiles?: string[];
    existingFiles?: Record<string, string>;
    systemInfo?: { os: string; arch: string; home_dir: string; desktop_dir: string; documents_dir: string; downloads_dir: string };
  }): Promise<GenerationPlan>;
  /** Step 1 (build): Return a lightweight plan with file paths and descriptions — no code. */
  planBuild(args: {
    messages: ChatMessage[];
    scaffoldContext?: string;
    protectedFiles?: string[];
  }): Promise<{ plan: BuildPlan; rawResponse: string }>;
  /** Step 2 (build): Generate full file contents for a single checkpoint. */
  generateCheckpointFiles(args: {
    checkpointLabel: string;
    files: Array<{ path: string; description: string }>;
    scaffoldContext?: string;
    protectedFiles?: string[];
    previousFiles?: Record<string, string>;
    conversation: string;
    backendCommands?: BackendCommand[];
    systemInfo?: { os: string; arch: string; home_dir: string; desktop_dir: string; documents_dir: string; downloads_dir: string };
  }): Promise<{ files: Array<{ path: string; content: string }>; rawResponse: string }>;
  /** Step 1: Identify what edits are needed — returns a list of tasks (file + description). */
  planEdits(args: {
    messages: ChatMessage[];
    existingFiles: Record<string, string>;
  }): Promise<{ plan: EditPlan; rawResponse: string }>;
  /** Step 2: For a single edit task, produce the search/replace patch for that one file. */
  applyOneEdit(args: {
    task: EditTask;
    fileContent: string;
    allFiles: string[];
    /** Previous failed attempts for this task — fed back so the model can self-correct. */
    previousFailures?: string[];
  }): Promise<{ patches: FixPatch[]; rawResponse: string }>;
  proposeFix(args: ProposFixArgs): Promise<{ plan: FixPlan; rawResponse: string }>;
  /** Diagnostic-driven fix phase 1: AI decides what context it needs to investigate errors. */
  investigateErrors(args: InvestigateErrorsArgs): Promise<{ plan: InvestigationPlan; rawResponse: string }>;
  /** Diagnostic-driven fix phase 2: AI produces patches given gathered context. */
  diagnosticFix(args: DiagnosticFixArgs): Promise<{ plan: FixPlan; rawResponse: string }>;
  suggestAppNames(args: { messages: ChatMessage[] }): Promise<{ autoDetected: string | null; suggestions: string[] }>;
  generateLogos(args: { messages: ChatMessage[]; appName: string }): Promise<string[]>;
  refineLogos(args: { messages: ChatMessage[]; appName: string; currentSvg: string; instructions: string }): Promise<string[]>;
  /** Raw generation — send system + user prompt, get text back. Used by the agent loop. */
  rawGenerate(args: { system: string; user: string; json?: boolean; model?: "fast" | "pro"; images?: Array<{ mime: string; base64: string }> }): Promise<string>;
  /** Generate a brief, conversational status message using the fast model. Streams chunks via onChunk. */
  streamBriefStatus(args: { context: string; onChunk: (text: string) => void }): Promise<void>;
  /** Summarize long build error logs into a concise error description (fast model). */
  summarizeShipError(logs: string[]): Promise<string>;
  /** Propose code fixes for a failed Tauri build (pro model). */
  proposeShipFix(args: { errorSummary: string; fileContents: Record<string, string> }): Promise<{ plan: FixPlan; rawResponse: string }>;
}
