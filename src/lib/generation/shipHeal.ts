/**
 * Self-healing ship flow.
 *
 * When `npx tauri build` fails, this module:
 * 1. Extracts/summarizes the build error from ship logs
 * 2. Generates a lightweight manifest of all source files
 * 3. Asks the AI which files are relevant to the error (using the manifest)
 * 4. Reads only those files, then asks for search/replace patches
 * 5. Applies the patches via the workspace pipeline
 *
 * The caller (useShipHeal hook) re-triggers the ship after a successful fix.
 */

import { replaceBlock } from "@rain/editkit/core";
import type { AiProvider, FixPlan } from "../ai/types";
import {
  readProjectSourceFiles,
  readProjectFile,
  stageFiles,
  applyCheckpoint,
} from "../tauri/workspace";
import { generateSourceManifest, formatManifest } from "./sourceManifest";

const MAX_LOG_LINES_FOR_SUMMARY = 40;

export interface ShipFixResult {
  fixed: boolean;
  label: string;
  errorSummary: string;
  rawResponse: string;
}

export async function attemptShipFix(args: {
  provider: AiProvider;
  projectId: string;
  shipLogs: string[];
  onLog: (line: string) => void;
}): Promise<ShipFixResult> {
  const { provider, projectId, shipLogs, onLog } = args;

  // ── 1. Extract error from logs ──
  const errorLines = shipLogs.filter((line) =>
    /error|ERROR|failed|FAILED|cannot find|not found|unexpected|panic/i.test(line)
  );
  const tailLines = errorLines.length > 0
    ? errorLines.slice(-20)
    : shipLogs.slice(-20);

  let errorSummary: string;

  if (tailLines.length > MAX_LOG_LINES_FOR_SUMMARY) {
    onLog("[ship-fix] Summarizing build error with fast model...");
    try {
      errorSummary = await provider.summarizeShipError(tailLines);
    } catch {
      errorSummary = tailLines.join("\n");
    }
  } else {
    errorSummary = tailLines.join("\n");
  }
  onLog(`[ship-fix] Error summary: ${errorSummary.slice(0, 300)}`);

  // ── 2. Generate manifest (lightweight summaries, not full content) ──
  onLog("[ship-fix] Generating file manifest...");
  let allFiles: Record<string, string> = {};
  try {
    allFiles = await readProjectSourceFiles(projectId, "src");
  } catch {
    onLog("[ship-fix] Could not read src/ files");
  }

  // Also read config files (small, always relevant to builds)
  for (const configPath of ["package.json", "tsconfig.json", "vite.config.ts", "index.html"]) {
    try {
      allFiles[configPath] = await readProjectFile(projectId, configPath);
    } catch {
      // file may not exist
    }
  }

  const manifest = await generateSourceManifest(provider, allFiles);
  const manifestStr = formatManifest(manifest);
  onLog(`[ship-fix] Manifest ready (${Object.keys(manifest.files).length} files)`);

  // ── 3. Ask AI which files are relevant to this error ──
  onLog("[ship-fix] Asking AI to identify relevant files...");

  // Also extract file paths mentioned directly in the error
  const errorText = errorSummary + "\n" + tailLines.join("\n");
  const errorMentionedFiles = new Set<string>();
  const fileRefPattern = /(?:^|\s)((?:src|app)\/[^\s:()"]+\.(?:tsx?|css|json))/g;
  let match;
  while ((match = fileRefPattern.exec(errorText)) !== null) {
    errorMentionedFiles.add(match[1]);
  }

  let filesToRead: string[];
  try {
    const triageResponse = await provider.rawGenerate({
      system: `You are a build error analyst. Given a file manifest (summaries of each source file) and a build error, identify which files need to be read to fix the error.

Return ONLY a JSON array of file paths, e.g.: ["src/App.tsx", "src/components/Header.tsx", "package.json"]

Include:
- Files directly mentioned in the error
- Files whose manifest description suggests they contain the broken code
- Config files if the error is about configuration (tsconfig, vite config, etc.)

Do NOT include files that are clearly unrelated to the error. Aim for the minimum set needed.`,
      user: `FILE MANIFEST:
${manifestStr}

BUILD ERROR:
${errorSummary}

Which files should I read to fix this error? Return a JSON array of file paths.`,
      json: true,
      model: "fast",
    });

    const parsed = JSON.parse(triageResponse.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    filesToRead = Array.isArray(parsed) ? parsed.filter((p: unknown) => typeof p === "string") : [];
  } catch {
    // Fallback: use files mentioned in the error
    filesToRead = [];
  }

  // Always include files explicitly mentioned in the error
  for (const f of errorMentionedFiles) filesToRead.push(f);
  // Deduplicate
  filesToRead = [...new Set(filesToRead)];

  onLog(`[ship-fix] AI identified ${filesToRead.length} relevant file(s): ${filesToRead.join(", ")}`);

  // ── 4. Read only the relevant files ──
  const fileContents: Record<string, string> = {};
  for (const filePath of filesToRead) {
    // Use already-read content if available (we read them for the manifest)
    if (allFiles[filePath]) {
      fileContents[filePath] = allFiles[filePath];
    } else {
      try {
        fileContents[filePath] = await readProjectFile(projectId, filePath);
      } catch {
        onLog(`[ship-fix] Could not read ${filePath}`);
      }
    }
  }
  onLog(`[ship-fix] Read ${Object.keys(fileContents).length} file(s)`);

  // ── 5. Ask AI for fix (with only relevant file contents) ──
  onLog("[ship-fix] Asking AI to fix the build error...");
  let fixResult: { plan: FixPlan; rawResponse: string };
  try {
    fixResult = await provider.proposeShipFix({ errorSummary, fileContents });
  } catch (err) {
    onLog(`[ship-fix] AI call failed: ${err}`);
    return { fixed: false, label: "", errorSummary, rawResponse: String(err) };
  }

  const { plan, rawResponse } = fixResult;

  if (plan.patches.length === 0) {
    onLog("[ship-fix] AI returned no patches — cannot fix");
    return { fixed: false, label: plan.label, errorSummary, rawResponse };
  }

  onLog(`[ship-fix] Received ${plan.patches.length} patch(es): ${plan.label}`);

  // ── 6. Apply patches ──
  const fixedFiles: Array<{ path: string; content: string }> = [];

  for (const patch of plan.patches) {
    let currentContent: string;
    const alreadyPatched = fixedFiles.find((f) => f.path === patch.path);
    if (alreadyPatched) {
      currentContent = alreadyPatched.content;
    } else {
      currentContent = fileContents[patch.path] ?? "";
      if (!currentContent) {
        try {
          currentContent = await readProjectFile(projectId, patch.path);
        } catch {
          onLog(`[ship-fix] Cannot read ${patch.path} — skipping`);
          continue;
        }
      }
    }

    try {
      const result = replaceBlock(currentContent, patch.old, patch.new);
      onLog(`[ship-fix] Applied patch to ${patch.path} (${result.strategy})`);
      if (alreadyPatched) {
        alreadyPatched.content = result.updated;
      } else {
        fixedFiles.push({ path: patch.path, content: result.updated });
      }
    } catch (err) {
      onLog(`[ship-fix] Patch failed on ${patch.path}: ${err}`);
      return { fixed: false, label: plan.label, errorSummary, rawResponse };
    }
  }

  if (fixedFiles.length === 0) {
    onLog("[ship-fix] No files were patched");
    return { fixed: false, label: plan.label, errorSummary, rawResponse };
  }

  // ── 7. Stage & apply via workspace pipeline ──
  const genId = `ship-fix-${Date.now()}`;
  onLog("[ship-fix] Staging fixed files...");
  await stageFiles(projectId, genId, fixedFiles);

  onLog("[ship-fix] Applying checkpoint...");
  const filePaths = fixedFiles.map((f) => f.path);
  await applyCheckpoint(projectId, genId, filePaths);

  onLog(`[ship-fix] Fix applied: ${plan.label}`);
  return { fixed: true, label: plan.label, errorSummary, rawResponse };
}
