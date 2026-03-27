/**
 * Agent loop — multi-step tool-calling pipeline for edits.
 *
 * Instead of reading ALL source files and making a single LLM call,
 * the agent:
 *   1. Reads a lightweight file manifest (plain-English summaries)
 *   2. Decides which files to read/edit via tool calls
 *   3. Executes tools, feeds results back
 *   4. Loops until the AI says "done"
 *
 * This is cheaper and smarter than the single-shot approach because
 * the LLM only reads what it needs.
 */

import type { ChatMessage } from "../chat/types";
import { DESIGN_GUIDELINES } from "./prompts";
import { replaceBlock } from "@rain/editkit/core";
import { readProjectFile, grepProjectFiles, listDir, writeProjectFile, deleteProjectFile, runValidation } from "../tauri/workspace";
import type { DirEntry } from "../tauri/workspace";
import { webSearch, webFetch } from "@rain/webtools";

/** CORS-bypassing fetch via Tauri HTTP plugin. Lazy-loaded to avoid Vite resolution issues. */
let _tauriFetch: typeof globalThis.fetch | null = null;
async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (!_tauriFetch) {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      _tauriFetch = mod.fetch;
    } catch {
      _tauriFetch = globalThis.fetch;
    }
  }
  return _tauriFetch;
}

// ── Types ──

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentTurn {
  status: string;          // natural-language description for the user
  tool_calls: AgentToolCall[];
  done: boolean;
}

export interface AgentResult {
  /** Files modified or created by the agent. path → full content */
  modifiedFiles: Map<string, string>;
  /** Final message to the user */
  message: string;
  /** All status messages emitted during the loop */
  statusLog: string[];
}

export interface AgentConfig {
  projectId: string;
  messages: ChatMessage[];
  manifest: string;   // pre-built file manifest (plain-English summaries)
  generate: (system: string, user: string, images?: Array<{ mime: string; base64: string }>) => Promise<string>;
  /** Called with each natural-language status the agent emits */
  onStatus: (text: string) => void;
  /** Called before each tool is executed — tool name + serialized args */
  onToolCall?: (toolName: string, toolArgs: string) => void;
  /** Called when the agent uses rename_project — updates the tab name + database */
  onRenameProject?: (newName: string) => void;
  onLog: (line: string) => void;
  /** Check if the session has been cancelled */
  isAborted: () => boolean;
  /** Images from the user's chat messages — passed to the LLM on the first turn */
  images?: Array<{ mime: string; base64: string }>;
}

// ── Tool definitions ──

const TOOLS: AgentTool[] = [
  {
    name: "read_file",
    description: "Read the full contents of a source file. Use this when you need to see the actual code before editing.",
    parameters: {
      path: { type: "string", description: "Relative path to the file (e.g. 'src/components/Header.tsx')", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a specific substring with new content. The 'search' must be an exact substring from the current file content. Keep the search string short but unique enough to match only once.",
    parameters: {
      path: { type: "string", description: "Relative path to the file", required: true },
      search: { type: "string", description: "Exact substring to find in the file (must match character-for-character)", required: true },
      replace: { type: "string", description: "Replacement text", required: true },
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given content. Only use this for files that don't exist yet.",
    parameters: {
      path: { type: "string", description: "Relative path for the new file", required: true },
      content: { type: "string", description: "Full file content", required: true },
    },
  },
  {
    name: "grep",
    description: "Search for a pattern across all source files. Returns matching lines with file paths and line numbers. Use this to find where something is used before editing.",
    parameters: {
      pattern: { type: "string", description: "Search pattern (plain text or regex)", required: true },
      file_glob: { type: "string", description: "Optional file glob filter (e.g. '*.tsx')" },
    },
  },
  {
    name: "list_files",
    description: "List all source files in the project. Returns just the file paths.",
    parameters: {},
  },
  {
    name: "rename_project",
    description: "Change the app's display name in the tab bar and database. Use this whenever the user renames their app. This ONLY updates the project-level name — you must ALSO grep for the old name in source files and use edit_file to update it there too.",
    parameters: {
      name: { type: "string", description: "The new name for the app", required: true },
    },
  },
  {
    name: "web_search",
    description: "Search the web for information. Use this when you need to look up documentation, find API references, troubleshoot errors, or get real-time information. Returns titles, URLs, and snippets.",
    parameters: {
      query: { type: "string", description: "The search query", required: true },
      max_results: { type: "number", description: "Maximum results to return (default 5)" },
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a URL and extract its content as clean Markdown. Use this to read documentation pages, API references, tutorials, or any web page. Returns the page title, extracted content, and word count.",
    parameters: {
      url: { type: "string", description: "The URL to fetch", required: true },
      max_length: { type: "number", description: "Max content chars (default 15000)" },
    },
  },
  {
    name: "verify",
    description: "Write all pending changes to disk and run TypeScript type-checking (tsc --noEmit). Use this BEFORE setting done=true to catch compilation errors while you can still fix them. Returns 'OK' or a list of errors. If there are errors, fix them with edit_file and verify again.",
    parameters: {},
  },
];

// ── System prompt ──

function buildAgentSystemPrompt(manifest: string): string {
  const toolDefs = TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, p]) => `    "${name}": ${p.type}${p.required ? " (required)" : " (optional)"} — ${p.description}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params || "    (none)"}`;
  }).join("\n\n");

  return `You are an expert code editor working on a desktop app built with React + TypeScript + Vite + Tauri.

Your job is to fulfill the user's request by reading and editing the source files. You have tools available to do this.

## File Manifest
This is a summary of every source file in the project. Use it to decide which files to read — don't read everything, only what's relevant.

${manifest}

## Available Tools

${toolDefs}

## How to respond

Return JSON on every turn:
{
  "status": "A natural, friendly description of what you're doing right now — written for the user to see, not technical. E.g. 'Looking at the sidebar to find the app title...' or 'Updated the color scheme in the main layout!'",
  "tool_calls": [
    { "tool": "tool_name", "args": { ... } }
  ],
  "done": false
}

Rules:
- ALWAYS call \`verify\` before setting "done": true. This runs TypeScript type-checking on your changes. If verify reports errors, fix them and verify again. Only set done=true after verify passes.
- You can make multiple tool_calls in one turn if they're independent (e.g. reading two files at once).
- ALWAYS read a file before editing it — you need to see the current content to write a correct "search" string.
- The "search" in edit_file must be an EXACT substring from the file. Copy it character-for-character. Keep it short (3-10 lines) but unique.
- Write natural, friendly status messages — the user sees these. Don't say "calling read_file" — say what you're actually doing.
- If a tool returns an error, adapt your approach. Don't retry the same failing call.
- Stay focused on the user's request. Don't make changes beyond what was asked.

## Common Action Patterns

Think about what a request actually requires. Many requests need multiple coordinated actions:

- **Rename the app**: Call \`rename_project\` to update the tab/database name, THEN \`grep\` for the old name in source files, THEN \`edit_file\` to update every occurrence. Both steps are required — the user expects the name to change everywhere.
- **Change UI elements**: \`read_file\` the component, then \`edit_file\` to modify it.
- **Add a feature**: \`list_files\` or check the manifest, \`read_file\` relevant components, then \`edit_file\` or \`create_file\`.
- **Change styling/colors**: \`read_file\` the component or CSS, then \`edit_file\` to update styles.
- **Remove something**: \`grep\` to find all usages first, then \`edit_file\` to remove from each file.
- **Follow imports**: When you read a file, you'll see hints about files it imports. If those files are relevant to your task, read them too — this builds up context just like following the dependency chain. Don't ignore import hints when working on interconnected components.
- **Fix a stubborn error**: If you've tried multiple fixes and keep failing, use \`web_search\` to look up the error message or API docs, then \`web_fetch\` to read the relevant page.
- **Add an API integration**: Use \`web_search\` to find the official docs, \`web_fetch\` to read the API reference, then implement with the correct endpoints and types.
- **Need real-time info**: Use \`web_search\` for anything that requires up-to-date information (package versions, API changes, etc).

## UI Quality Standard
When making ANY visual change — styling, layout, colors, components — follow this standard:
${DESIGN_GUIDELINES}`;
}

// ── Import detection ──

/**
 * Extract resolved import paths from a file's content.
 * Turns `import X from "./components/Foo"` → `src/components/Foo.tsx` (relative to project root).
 * Only follows local relative imports (not node_modules).
 */
function extractImportPaths(content: string, filePath: string): string[] {
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const importRegex = /(?:import|from)\s+["'](\.[^"']+)["']/g;
  const paths: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const raw = match[1]; // e.g. "./components/Foo" or "../hooks/useData"
    // Resolve relative to the file's directory
    const parts = (dir ? `${dir}/${raw}` : raw).split("/");
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === ".") continue;
      if (p === "..") { resolved.pop(); continue; }
      resolved.push(p);
    }
    const base = resolved.join("/");
    // Try common extensions
    for (const ext of ["", ".ts", ".tsx", ".css"]) {
      paths.push(`${base}${ext}`);
    }
  }
  // Deduplicate and return only plausible source files
  return [...new Set(paths)].filter((p) => /\.(tsx?|css)$/.test(p));
}

// ── Tool execution ──

async function executeTool(
  call: AgentToolCall,
  projectId: string,
  fileState: Map<string, string>,
  log: (line: string) => void,
): Promise<string> {
  const { tool, args } = call;

  switch (tool) {
    case "read_file": {
      const path = args.path as string;
      if (!path) return "Error: 'path' is required";
      try {
        // Check if we already have modified content in memory
        if (fileState.has(path)) {
          const content = fileState.get(path)!;
          log(`  [read_file] ${path} (from memory, ${content.split("\n").length} lines)`);
          return content;
        }
        const content = await readProjectFile(projectId, path);
        fileState.set(path, content);
        log(`  [read_file] ${path} (${content.split("\n").length} lines)`);

        // Detect imports/references → hint about related files the agent should consider reading
        const importHints = extractImportPaths(content, path);
        const unreadHints = importHints.filter((p) => !fileState.has(p));
        if (unreadHints.length > 0) {
          return `${content}\n\n[Hint: This file imports from: ${unreadHints.join(", ")} — consider reading them if relevant to your task.]`;
        }
        return content;
      } catch {
        log(`  [read_file] ${path} — NOT FOUND`);
        return `Error: File "${path}" not found.`;
      }
    }

    case "edit_file": {
      const path = args.path as string;
      const search = args.search as string;
      const replace = args.replace as string;
      if (!path || search === undefined || replace === undefined) {
        return "Error: 'path', 'search', and 'replace' are all required";
      }

      // Get current content — must have been read first
      let content = fileState.get(path);
      if (content === undefined) {
        // Try to read it
        try {
          content = await readProjectFile(projectId, path);
          fileState.set(path, content);
        } catch {
          return `Error: File "${path}" not found. Read it first or use create_file.`;
        }
      }

      try {
        const result = replaceBlock(content, search, replace);
        fileState.set(path, result.updated);
        log(`  [edit_file] ${path} — ${result.strategy}`);
        return `OK: Edited ${path} successfully (strategy: ${result.strategy})`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  [edit_file] ${path} — FAILED: ${msg}`);
        return `Error: ${msg}. Make sure 'search' is an exact substring from the file. Try reading the file again to get the exact content.`;
      }
    }

    case "create_file": {
      const path = args.path as string;
      const content = args.content as string;
      if (!path || content === undefined) {
        return "Error: 'path' and 'content' are required";
      }
      fileState.set(path, content);
      log(`  [create_file] ${path} (${content.split("\n").length} lines)`);
      return `OK: Created ${path}`;
    }

    case "grep": {
      const pattern = args.pattern as string;
      if (!pattern) return "Error: 'pattern' is required";
      const fileGlob = args.file_glob as string | undefined;
      try {
        const matches = await grepProjectFiles(projectId, pattern, fileGlob, 30);
        if (matches.length === 0) {
          log(`  [grep] "${pattern}" — no matches`);
          return "No matches found.";
        }
        log(`  [grep] "${pattern}" — ${matches.length} match(es)`);
        return matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
      } catch {
        return "Error: grep failed.";
      }
    }

    case "list_files": {
      try {
        const files: string[] = [];
        async function walk(dir: string) {
          let entries: DirEntry[];
          try {
            entries = await listDir(projectId, dir);
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.is_dir) {
              if (entry.name !== "node_modules" && entry.name !== ".rain" && entry.name !== "target" && entry.name !== "src-tauri") {
                await walk(full);
              }
            } else if (/\.(tsx?|css|html)$/.test(entry.name)) {
              files.push(full);
            }
          }
        }
        await walk("src");
        log(`  [list_files] ${files.length} file(s)`);
        return files.join("\n") || "No source files found.";
      } catch {
        return "Error: could not list files.";
      }
    }

    case "web_search": {
      const query = args.query as string;
      if (!query) return "Error: 'query' is required";
      const maxResults = (args.max_results as number) || 5;
      try {
        const fetchFn = await getTauriFetch();
        const results = await webSearch(query, { maxResults, timeoutMs: 8000, fetchFn });
        if (results.length === 0) {
          log(`  [web_search] "${query}" — no results`);
          return "No results found.";
        }
        log(`  [web_search] "${query}" — ${results.length} result(s)`);
        return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      } catch (err) {
        log(`  [web_search] "${query}" — FAILED: ${err}`);
        return `Error: Web search failed — ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    case "web_fetch": {
      const url = args.url as string;
      if (!url) return "Error: 'url' is required";
      const maxLength = (args.max_length as number) || 15000;
      try {
        const fetchFn = await getTauriFetch();
        const page = await webFetch(url, { maxContentLength: maxLength, timeoutMs: 10000, fetchFn });
        log(`  [web_fetch] ${url} — ${page.wordCount} words, ${page.elapsedMs}ms`);
        return `# ${page.title}\n\nURL: ${page.url}\nWords: ${page.wordCount}\n\n${page.content}`;
      } catch (err) {
        log(`  [web_fetch] ${url} — FAILED: ${err}`);
        return `Error: Fetch failed — ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    default:
      return `Error: Unknown tool "${tool}"`;
  }
}

// ── Compacting ──

/**
 * Token threshold for triggering compaction.
 * When agent history exceeds this, older turns are summarized into a compact
 * summary — same pattern as Claude Code's conversation compacting.
 *
 * This prevents the "context snowball" problem where each turn sends
 * exponentially more tokens (system prompt + full history + new content).
 */
const COMPACT_THRESHOLD_TOKENS = 20_000;

/** Rough token estimate: ~4 chars per token for English/code */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compact the agent history by summarizing older turns.
 *
 * Keeps:
 *   - First entry (original user request — the task)
 *   - Last 2 entries (most recent context the LLM needs)
 * Compacts:
 *   - Everything in between → one LLM-generated summary
 *
 * This mirrors how Claude Code compacts conversations:
 *   1. Preserve what the user asked
 *   2. Preserve what just happened (latest tool results)
 *   3. Compress the middle into a summary of actions taken, files modified,
 *      errors encountered, and current progress
 */
async function compactHistory(
  agentHistory: Array<{ role: "user" | "tool_results"; content: string }>,
  fileState: Map<string, string>,
  generate: (system: string, user: string) => Promise<string>,
  onLog: (line: string) => void,
): Promise<void> {
  if (agentHistory.length <= 3) return;

  const firstEntry = agentHistory[0];
  const middleEntries = agentHistory.slice(1, -2);
  const recentEntries = agentHistory.slice(-2);

  const middleText = middleEntries
    .map((h) => (h.role === "tool_results" ? `[Tool Results]\n${h.content}` : h.content))
    .join("\n\n---\n\n");

  const modifiedFiles = [...fileState.keys()];

  const compactStart = performance.now();
  const summary = await generate(
    "You are a conversation compactor. Produce a concise but complete summary of an AI agent's work history. Never omit file paths, error messages, or decisions — the agent needs these to continue.",
    `Summarize this agent work history. Preserve:
- Every file that was read, edited, or created (with paths)
- What changes were made and why
- Any errors encountered and how they were resolved or are still pending
- Current progress toward the goal
- Modified files so far: ${modifiedFiles.join(", ") || "none yet"}

Be concise — bullet points, not prose. Skip raw file contents but keep key details.

---

${middleText}`,
  );
  const compactMs = Math.round(performance.now() - compactStart);

  const oldTokens = estimateTokens(middleEntries.map((h) => h.content).join(""));
  const newTokens = estimateTokens(summary);

  // Replace history: original request + compact summary + recent entries
  agentHistory.length = 0;
  agentHistory.push(firstEntry);
  agentHistory.push({
    role: "tool_results",
    content: `[Compacted History — ${middleEntries.length} turns summarized]\n\n${summary}`,
  });
  agentHistory.push(...recentEntries);

  onLog(`  [Compact] ${middleEntries.length} entries: ~${oldTokens.toLocaleString()} → ~${newTokens.toLocaleString()} tokens (${compactMs}ms)`);
}

// ── Verify: compilation + semantic review ──

async function runVerify(
  projectId: string,
  fileState: Map<string, string>,
  generate: (system: string, user: string) => Promise<string>,
  conversation: string,
  log: (line: string) => void,
): Promise<string> {
  // 1. Write all modified files to disk
  const modifiedPaths: string[] = [];
  for (const [filePath, content] of fileState) {
    try {
      await writeProjectFile(projectId, filePath, content);
      modifiedPaths.push(filePath);
    } catch (err) {
      log(`  [verify] Failed to write ${filePath}: ${err}`);
    }
  }
  log(`  [verify] Wrote ${modifiedPaths.length} file(s) to disk`);

  const issues: string[] = [];

  // 2. TypeScript compilation check
  try {
    log(`  [verify] Running tsc --noEmit...`);
    const tsResult = await runValidation(projectId, ["npx tsc --noEmit"]);
    if (tsResult.ok) {
      log(`  [verify] TypeScript — PASSED`);
    } else {
      const tsErrors = [...tsResult.stdout_tail, ...tsResult.stderr_tail]
        .filter((l) => l.includes("error TS"))
        .join("\n");
      const count = tsErrors.split("\n").filter(Boolean).length;
      log(`  [verify] TypeScript — ${count} error(s)`);
      issues.push(`TYPESCRIPT ERRORS (${count}):\n${tsErrors}`);
    }
  } catch (err) {
    log(`  [verify] tsc failed: ${err}`);
    issues.push(`TypeScript check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Rust compilation check (only if src-tauri/ files were touched)
  const hasRustChanges = modifiedPaths.some((p) => p.startsWith("src-tauri/"));
  if (hasRustChanges) {
    try {
      log(`  [verify] Running cargo check...`);
      const rustResult = await runValidation(projectId, ["cargo check"]);
      if (rustResult.ok) {
        log(`  [verify] Rust — PASSED`);
      } else {
        const rustErrors = [...rustResult.stdout_tail, ...rustResult.stderr_tail]
          .filter((l) => l.includes("error"))
          .join("\n");
        const count = rustErrors.split("\n").filter(Boolean).length;
        log(`  [verify] Rust — ${count} error(s)`);
        issues.push(`RUST ERRORS (${count}):\n${rustErrors}`);
      }
    } catch (err) {
      log(`  [verify] cargo check failed: ${err}`);
      issues.push(`Rust check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // If compilation failed, return those errors first — no point reviewing logic if it doesn't compile
  if (issues.length > 0) {
    return `${issues.join("\n\n")}\n\nFix compilation errors first, then call verify again.`;
  }

  // 4. Semantic review — does the code actually solve the user's request?
  log(`  [verify] Compilation passed. Running semantic review...`);
  const changedFilesBlock = modifiedPaths
    .map((p) => {
      const content = fileState.get(p);
      if (!content) return "";
      // Limit per file to avoid blowing context
      const trimmed = content.length > 3000 ? content.slice(0, 3000) + "\n... (truncated)" : content;
      return `── ${p} ──\n${trimmed}\n── end ${p} ──`;
    })
    .filter(Boolean)
    .join("\n\n");

  try {
    const reviewResponse = await generate(
      `You are a code reviewer verifying that changes correctly address the user's request. You are NOT checking for compilation errors (those already passed). You are checking for LOGICAL and BEHAVIORAL correctness.

Check these things:
1. Does the code ACTUALLY do what the user asked? Not just look like it — does the logic work?
2. Are there placeholder/stub implementations that compile but don't do anything real? (e.g., empty function bodies, hardcoded returns, TODO comments, console.log instead of real logic)
3. Are there missing pieces? (e.g., user asked for filtering but the filter function doesn't actually filter, buttons that have onClick but the handler is empty)
4. Are event handlers wired up correctly? (e.g., onClick actually calls the right function with the right args)
5. Are data flows correct? (e.g., state updates trigger re-renders, props are passed down correctly)
6. For Rust backend commands: does the command actually perform the OS operation described, or is it a stub?

Return JSON:
{
  "pass": true/false,
  "issues": ["list of specific issues found — be concrete, reference file:line"]
}

If everything looks correct and complete, return { "pass": true, "issues": [] }.
Be strict but fair — only flag real problems, not style preferences.`,
      `USER REQUEST:\n${conversation}\n\nCHANGED FILES:\n${changedFilesBlock}`,
    );

    // Parse review result
    const jsonMatch = reviewResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const review = JSON.parse(jsonMatch[0]) as { pass: boolean; issues: string[] };
      if (review.pass) {
        log(`  [verify] Semantic review — PASSED`);
        return "OK: Compilation passed and code review confirms your changes correctly address the user's request.";
      }
      const issueList = review.issues.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
      log(`  [verify] Semantic review — ${review.issues.length} issue(s)`);
      return `COMPILATION PASSED but code review found issues:\n${issueList}\n\nFix these issues, then call verify again.`;
    }

    // Couldn't parse — treat as pass (don't block on review failures)
    log(`  [verify] Semantic review — could not parse response, treating as pass`);
    return "OK: Compilation passed. (Semantic review inconclusive — proceed with caution.)";
  } catch (err) {
    log(`  [verify] Semantic review failed: ${err}`);
    // Don't block on review failures — compilation passed, that's the critical check
    return "OK: Compilation passed. (Semantic review could not run — proceed with caution.)";
  }
}

// ── Agent loop ──

const MAX_TURNS = 15;

export async function runAgentLoop(config: AgentConfig): Promise<AgentResult> {
  const {
    projectId,
    messages,
    manifest,
    generate,
    onStatus,
    onLog,
    isAborted,
  } = config;

  const fileState = new Map<string, string>();
  const statusLog: string[] = [];
  const system = buildAgentSystemPrompt(manifest);

  // Cache for list_files — directory tree doesn't change during an agent run
  let listFilesCache: string | null = null;

  // Build conversation context for the agent
  const conversationLines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      conversationLines.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant") {
      conversationLines.push(`Assistant: ${msg.content}`);
    }
  }

  // The rolling message history for the agent
  const agentHistory: Array<{ role: "user" | "tool_results"; content: string }> = [];

  // Initial user prompt
  agentHistory.push({
    role: "user",
    content: `Here is the conversation with the user. Fulfill their latest request by reading and editing the source files.

${conversationLines.join("\n")}

${config.images?.length ? `The user attached ${config.images.length} image(s) — you can see them alongside this message. Use the visual details to guide your edits (e.g. matching colors, layout, style from screenshots).\n\n` : ""}Begin by examining the manifest above to decide which files are relevant, then use tools to make the changes.`,
  });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (isAborted()) break;

    // ── Compaction check ──
    // If history has grown too large, summarize older turns to free up context.
    // This prevents the snowball effect where each turn sends more tokens.
    const historyTokens = estimateTokens(agentHistory.map((h) => h.content).join(""));
    if (historyTokens > COMPACT_THRESHOLD_TOKENS && agentHistory.length > 3) {
      onLog(`\n── Compacting (${historyTokens.toLocaleString()} tokens > ${COMPACT_THRESHOLD_TOKENS.toLocaleString()} threshold) ──`);
      onStatus("Compacting context...");
      await compactHistory(agentHistory, fileState, generate, onLog);
    }

    // Build the full user message from history
    const userContent = agentHistory.map((h) => {
      if (h.role === "tool_results") {
        return `[Tool Results]\n${h.content}`;
      }
      return h.content;
    }).join("\n\n");

    onLog(`\n── Agent Turn ${turn + 1} ──`);

    // Log prompt size so we can spot context bloat
    const systemTokens = estimateTokens(system);
    const userTokens = estimateTokens(userContent);
    onLog(`  Prompt: ~${(systemTokens + userTokens).toLocaleString()} tokens (system: ~${systemTokens.toLocaleString()}, user: ~${userTokens.toLocaleString()}, chars: ${(system.length + userContent.length).toLocaleString()})`);

    // Pass images only on the first turn — the LLM sees the visual reference once,
    // then works from that understanding on subsequent turns. Sending large base64
    // images every turn would be too expensive.
    const turnImages = turn === 0 ? config.images : undefined;

    const llmStart = performance.now();
    const rawResponse = await generate(system, userContent, turnImages);
    const llmMs = Math.round(performance.now() - llmStart);
    onLog(`  [LLM] ${llmMs}ms`);
    onLog(`  Raw response: ${rawResponse.slice(0, 500)}...`);

    // Parse the response
    let parsed: AgentTurn;
    try {
      // Extract JSON from the response (may have markdown code fences)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      parsed = JSON.parse(jsonMatch[0]) as AgentTurn;
    } catch (err) {
      onLog(`  Failed to parse agent response: ${err}`);
      // Try one more time by asking for valid JSON
      agentHistory.push({
        role: "tool_results",
        content: "Your response was not valid JSON. Please respond with a valid JSON object with keys: status, tool_calls, done.",
      });
      continue;
    }

    // Emit status to the user
    if (parsed.status) {
      onStatus(parsed.status);
      statusLog.push(parsed.status);
      onLog(`  Status: ${parsed.status}`);
    }

    // Check if done
    if (parsed.done) {
      onLog(`  Agent is done.`);
      // Collect all modified files
      const modifiedFiles = new Map<string, string>();
      for (const [path, content] of fileState) {
        modifiedFiles.set(path, content);
      }
      return {
        modifiedFiles,
        message: parsed.status || "Done!",
        statusLog,
      };
    }

    // Execute tool calls
    if (!parsed.tool_calls || parsed.tool_calls.length === 0) {
      // No tools and not done — nudge it
      agentHistory.push({
        role: "tool_results",
        content: "You didn't call any tools and didn't set done=true. Either call a tool to make progress, or set done=true if you're finished.",
      });
      continue;
    }

    // Execute tool calls in parallel — the LLM already groups independent calls
    const toolsStart = performance.now();
    const toolPromises = parsed.tool_calls.map(async (call) => {
      if (isAborted()) return "";
      const argsStr = JSON.stringify(call.args).slice(0, 200);
      onLog(`  Tool: ${call.tool}(${argsStr})`);
      config.onToolCall?.(call.tool, argsStr);

      const toolStart = performance.now();

      // verify is handled here (not in executeTool) since it needs access to generate + conversation
      if (call.tool === "verify") {
        onLog(`  [verify] Starting compilation + semantic review...`);
        const verifyResult = await runVerify(projectId, fileState, generate, conversationLines.join("\n"), onLog);
        const toolMs = Math.round(performance.now() - toolStart);
        onLog(`  [verify] ${toolMs}ms`);
        return `[verify] ${verifyResult}`;
      }

      // rename_project is handled here (not in executeTool) since it's a system-level action
      if (call.tool === "rename_project") {
        const name = call.args.name as string;
        if (!name) {
          return `[rename_project] Error: 'name' is required`;
        }
        config.onRenameProject?.(name);
        onLog(`  [rename_project] → "${name}"`);
        return `[rename_project] OK: Project renamed to "${name}". Now grep for the old name in source files and update those references too.`;
      }

      // list_files cache — directory tree doesn't change mid-run
      if (call.tool === "list_files" && listFilesCache !== null) {
        const cacheMs = Math.round(performance.now() - toolStart);
        onLog(`  [list_files] cached (${cacheMs}ms)`);
        return `[list_files] ${listFilesCache}`;
      }

      const result = await executeTool(call, projectId, fileState, onLog);

      // Populate list_files cache on first call
      if (call.tool === "list_files" && !result.startsWith("Error")) {
        listFilesCache = result;
      }

      const toolMs = Math.round(performance.now() - toolStart);
      onLog(`  [${call.tool}] ${toolMs}ms`);
      return `[${call.tool}] ${result}`;
    });

    const results = await Promise.all(toolPromises);
    const totalToolsMs = Math.round(performance.now() - toolsStart);
    onLog(`  Tools total: ${totalToolsMs}ms (${parsed.tool_calls.length} call(s))`);

    // Feed results back
    agentHistory.push({
      role: "tool_results",
      content: results.filter(Boolean).join("\n\n"),
    });
  }

  // If we reached max turns without done=true
  const modifiedFiles = new Map<string, string>();
  for (const [path, content] of fileState) {
    modifiedFiles.set(path, content);
  }
  return {
    modifiedFiles,
    message: statusLog[statusLog.length - 1] || "Changes applied.",
    statusLog,
  };
}

// ── Rust Agent Loop ──────────────────────────────────────────────────

export interface RustAgentConfig {
  projectId: string;
  /** Initial Rust files to seed the agent with */
  initialFiles: {
    commandsRs: string;
    libRs?: string;
    mainRs: string;
    cargoToml: string;
  };
  /** Description of what each command should do */
  commandSpecs: string;
  /** User's original conversation for semantic review */
  conversation: string;
  /** System info (OS, dirs) so the agent generates platform-correct code */
  systemInfo?: string;
  generate: (system: string, user: string) => Promise<string>;
  onStatus: (text: string) => void;
  onLog: (line: string) => void;
  isAborted: () => boolean;
}

export interface RustAgentResult {
  /** Whether the backend compiled and passed review */
  success: boolean;
  /** Final files (path → content) */
  files: Map<string, string>;
  message: string;
}

/** Retry an AI generate call with backoff for transient errors. */
async function retryGenerate(
  generate: (system: string, user: string) => Promise<string>,
  system: string,
  user: string,
  maxRetries: number,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generate(system, user);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /network|connection|timeout|load failed|fetch failed|socket|econn|503|429|500|502|504/i.test(msg);
      if (attempt < maxRetries && isTransient) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const RUST_TOOLS: AgentTool[] = [
  {
    name: "read_file",
    description: "Read a file from the src-tauri/ directory. Use this to check current file content before editing.",
    parameters: {
      path: { type: "string", description: "Relative path inside the project (e.g. 'src-tauri/src/commands.rs', 'src-tauri/Cargo.toml')", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a specific substring with new content. The 'search' must be an exact substring from the current file.",
    parameters: {
      path: { type: "string", description: "Relative path to the file", required: true },
      search: { type: "string", description: "Exact substring to find", required: true },
      replace: { type: "string", description: "Replacement text", required: true },
    },
  },
  {
    name: "write_file",
    description: "Overwrite a file completely with new content. Use this when the file needs major restructuring rather than small edits.",
    parameters: {
      path: { type: "string", description: "Relative path to the file", required: true },
      content: { type: "string", description: "Full file content", required: true },
    },
  },
  {
    name: "delete_file",
    description: "Delete a file. Use when you need to remove a conflicting or duplicate file (e.g., removing commands.rs after moving all code into lib.rs).",
    parameters: {
      path: { type: "string", description: "Relative path to the file to delete", required: true },
    },
  },
  {
    name: "cargo_check",
    description: "Run `cargo check` to compile the Rust backend. Returns 'OK' if compilation succeeds, or error messages if it fails. Also lists all Rust files on disk to help spot duplicate definitions. Call this after making changes.",
    parameters: {},
  },
  {
    name: "verify",
    description: "Run cargo check AND a semantic correctness review. The review checks that each command actually implements the described behavior — not just compiles. ALWAYS call this before setting done=true.",
    parameters: {},
  },
];

const MAX_RUST_TURNS = 50;

function buildRustAgentPrompt(commandSpecs: string, conversation: string, systemInfo?: string): string {
  const toolDefs = RUST_TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, p]) => `    "${name}": ${p.type}${p.required ? " (required)" : " (optional)"} — ${p.description}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params || "    (none)"}`;
  }).join("\n\n");

  const sysBlock = systemInfo ? `\n## Target System\n${systemInfo}\n` : "";

  return `You are a Rust backend developer working on a Tauri 2 desktop app. Your job is to make the Rust backend compile and correctly implement the required commands.
${sysBlock}
## Context
The user is building a desktop app. The frontend calls Rust commands via Tauri's invoke() system. You need to ensure:
1. All commands compile without errors
2. Each command actually implements the described behavior (not stubs)
3. Cargo.toml has the right dependencies
4. main.rs correctly registers all commands with tauri::generate_handler![]

## Required Commands
${commandSpecs}

## User's Request
${conversation}

## Available Tools
${toolDefs}

## How to respond
Return JSON on every turn:
{
  "status": "What you're doing (shown to user)",
  "tool_calls": [{ "tool": "tool_name", "args": { ... } }],
  "done": false
}

## File Paths — IMPORTANT
All Rust source files live under the \`src-tauri/\` prefix:
- \`src-tauri/Cargo.toml\` — NOT \`Cargo.toml\`
- \`src-tauri/src/main.rs\` — NOT \`src/main.rs\`
- \`src-tauri/src/lib.rs\` — NOT \`src/lib.rs\`
- \`src-tauri/src/commands.rs\` — NOT \`src/commands.rs\`
NEVER use paths without the \`src-tauri/\` prefix for Rust files.

## Tauri 2 Entry Point Pattern
Tauri 2 uses lib.rs + thin main.rs:
- \`src-tauri/src/lib.rs\`: contains \`pub fn run() { tauri::Builder::default()...invoke_handler(tauri::generate_handler![...]).run(...) }\`
- \`src-tauri/src/main.rs\`: just \`fn main() { <lib_name>::run() }\`
- The lib name in Cargo.toml \`[lib] name = "..."\` must match what main.rs calls

## Strategy
1. First, run cargo_check to see if the initial code compiles
2. If errors: read the relevant file (use full path like \`src-tauri/src/main.rs\`), fix with edit_file or write_file, then cargo_check again
3. Once cargo_check passes, call \`verify\` — this runs compilation AND a semantic review that checks each command actually does what it should
4. If verify reports issues (stubs, empty implementations, wrong logic), fix them and verify again
5. Only set done=true AFTER verify passes with no issues

Rules:
- ALWAYS call \`verify\` before setting done=true. Never set done=true without a passing verify.
- ALWAYS read a file before editing it
- ALWAYS use the \`src-tauri/\` prefix for all Rust file paths
- Use cargo_check for quick compilation checks during iterative fixes
- Use verify as the final gate — it checks both compilation AND correctness
- If the same error keeps recurring, try a different approach (rewrite the file instead of patching)
- Keep Cargo.toml dependencies minimal — only add crates you actually use
- All commands must use #[tauri::command] attribute
- lib.rs must use .invoke_handler(tauri::generate_handler![...]) with all commands`;
}

async function runRustVerify(
  projectId: string,
  fileState: Map<string, string>,
  commandSpecs: string,
  conversation: string,
  generate: (system: string, user: string) => Promise<string>,
  log: (line: string) => void,
): Promise<string> {
  // 1. Flush all files to disk
  for (const [path, content] of fileState) {
    await writeProjectFile(projectId, path, content);
  }

  // 2. Cargo check
  try {
    const result = await runValidation(projectId, ["cargo check"]);
    if (!result.ok) {
      const errors = [...result.stdout_tail, ...result.stderr_tail].join("\n");
      log("  [verify] Cargo check FAILED");
      return `CARGO CHECK FAILED:\n${errors}\n\nFix the compilation errors first, then call verify again.`;
    }
    log("  [verify] Cargo check PASSED");
  } catch (err) {
    log(`  [verify] Cargo check error: ${err}`);
    return `Cargo check failed to run: ${err instanceof Error ? err.message : String(err)}`;
  }

  // 3. Semantic review — does the code actually implement what's needed?
  log("  [verify] Running semantic review...");
  const commandsRs = fileState.get("src-tauri/src/commands.rs") || "";
  const mainRs = fileState.get("src-tauri/src/main.rs") || "";

  try {
    const reviewResponse = await retryGenerate(generate,
      `You are a Rust code reviewer for a Tauri 2 desktop app backend. Compilation has already passed. Now verify that each command ACTUALLY implements the described behavior — not just compiles.

Check:
1. Does each command do what its description says? (e.g., "list files" actually lists files, not returns empty vec)
2. Are there placeholder/stub implementations? (e.g., Ok(Vec::new()) when it should scan a directory, todo!(), unimplemented!(), empty match arms)
3. Are error cases handled? (permission denied, path not found, etc.)
4. Are the correct system APIs used? (std::fs for files, std::process::Command for shell, etc.)
5. Does main.rs register ALL commands in generate_handler![]?

Return JSON:
{ "pass": true/false, "issues": ["specific issue descriptions"] }

If everything is correctly implemented, return { "pass": true, "issues": [] }.
Be strict — stubs that compile but don't do real work must be flagged.`,
      `USER REQUEST:\n${conversation}\n\nCOMMAND SPECS:\n${commandSpecs}\n\ncommands.rs:\n${commandsRs}\n\nmain.rs:\n${mainRs}`,
      10,
    );

    const jsonMatch = reviewResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const review = JSON.parse(jsonMatch[0]) as { pass: boolean; issues: string[] };
      if (review.pass) {
        log("  [verify] Semantic review PASSED");
        return "OK: Compilation passed and all commands correctly implement the required behavior.";
      }
      const issueList = review.issues.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
      log(`  [verify] Semantic review — ${review.issues.length} issue(s)`);
      return `COMPILATION PASSED but code review found issues:\n${issueList}\n\nFix these issues, then call verify again.`;
    }

    log("  [verify] Could not parse review — treating as pass");
    return "OK: Compilation passed. (Semantic review inconclusive — proceed.)";
  } catch (err) {
    log(`  [verify] Semantic review failed: ${err}`);
    return "OK: Compilation passed. (Semantic review could not run — proceed.)";
  }
}

export async function runRustAgentLoop(config: RustAgentConfig): Promise<RustAgentResult> {
  const {
    projectId,
    initialFiles,
    commandSpecs,
    conversation,
    generate,
    onStatus,
    onLog,
    isAborted,
  } = config;

  // Seed file state with initial generated files
  const fileState = new Map<string, string>();
  fileState.set("src-tauri/src/commands.rs", initialFiles.commandsRs);
  if (initialFiles.libRs) {
    fileState.set("src-tauri/src/lib.rs", initialFiles.libRs);
  }
  fileState.set("src-tauri/src/main.rs", initialFiles.mainRs);
  fileState.set("src-tauri/Cargo.toml", initialFiles.cargoToml);

  // Write initial files to disk
  for (const [path, content] of fileState) {
    await writeProjectFile(projectId, path, content);
  }
  await writeProjectFile(projectId, "src-tauri/build.rs", "fn main() { tauri_build::build() }\n");

  // Minimal tauri.conf.json for cargo check
  const tauriConf = JSON.stringify({
    productName: "generated-app",
    version: "1.0.0",
    identifier: "com.raincast.check",
    build: { frontendDist: "../dist" },
    app: { windows: [{ title: "", width: 800, height: 600 }] },
  }, null, 2);
  await writeProjectFile(projectId, "src-tauri/tauri.conf.json", tauriConf);

  // capabilities
  const caps = JSON.stringify({
    identifier: "default",
    description: "Capability for the main window",
    windows: ["main"],
    permissions: ["core:default", "core:window:allow-start-dragging", "core:window:allow-toggle-maximize"],
  }, null, 2);
  await writeProjectFile(projectId, "src-tauri/capabilities/default.json", caps);

  const system = buildRustAgentPrompt(commandSpecs, conversation, config.systemInfo);
  const statusLog: string[] = [];

  type HistoryEntry = { role: "user" | "tool_results"; content: string };
  const agentHistory: HistoryEntry[] = [{
    role: "user",
    content: `The initial Rust files have been written. Start by running cargo_check to see if they compile. If there are errors, read the relevant files and fix them. Make sure every command has a real implementation.`,
  }];

  for (let turn = 0; turn < MAX_RUST_TURNS; turn++) {
    if (isAborted()) {
      return { success: false, files: fileState, message: "Aborted" };
    }

    const userContent = agentHistory.map((h) => {
      if (h.role === "tool_results") return `[Tool Results]\n${h.content}`;
      return h.content;
    }).join("\n\n");

    onLog(`\n── Rust Agent Turn ${turn + 1} ──`);

    // Call AI with retry for transient network errors
    let rawResponse: string;
    try {
      rawResponse = await retryGenerate(generate, system, userContent, 10);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onLog(`  ERROR: AI call failed after retries — ${errMsg}`);
      agentHistory.push({
        role: "tool_results",
        content: `AI call failed: ${errMsg}. Retrying on next turn.`,
      });
      continue;
    }
    onLog(`  Raw: ${rawResponse.slice(0, 300)}...`);

    let parsed: AgentTurn;
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      parsed = JSON.parse(jsonMatch[0]) as AgentTurn;
    } catch {
      agentHistory.push({
        role: "tool_results",
        content: "Your response was not valid JSON. Respond with { status, tool_calls, done }.",
      });
      continue;
    }

    if (parsed.status) {
      onStatus(parsed.status);
      statusLog.push(parsed.status);
      onLog(`  Status: ${parsed.status}`);
    }

    if (parsed.done) {
      onLog("  Rust agent is done.");
      return {
        success: true,
        files: fileState,
        message: parsed.status || "Rust backend ready",
      };
    }

    if (!parsed.tool_calls || parsed.tool_calls.length === 0) {
      agentHistory.push({
        role: "tool_results",
        content: "No tools called and not done. Call a tool or set done=true.",
      });
      continue;
    }

    // Execute tools sequentially (cargo_check needs files written first)
    const results: string[] = [];
    for (const call of parsed.tool_calls) {
      if (isAborted()) break;
      onLog(`  Tool: ${call.tool}(${JSON.stringify(call.args).slice(0, 200)})`);

      // verify is handled here (not in executeRustTool) since it needs generate + conversation
      if (call.tool === "verify") {
        onLog("  [verify] Running cargo check + semantic review...");
        const verifyResult = await runRustVerify(projectId, fileState, commandSpecs, conversation, generate, onLog);
        results.push(`[verify] ${verifyResult}`);
        continue;
      }

      const result = await executeRustTool(call, projectId, fileState, onLog);
      results.push(`[${call.tool}] ${result}`);
    }

    agentHistory.push({
      role: "tool_results",
      content: results.join("\n\n"),
    });
  }

  onLog("  Rust agent reached max turns");
  return {
    success: false,
    files: fileState,
    message: "Rust backend did not stabilize within turn limit",
  };
}

async function executeRustTool(
  call: AgentToolCall,
  projectId: string,
  fileState: Map<string, string>,
  log: (line: string) => void,
): Promise<string> {
  const { tool, args } = call;

  switch (tool) {
    case "read_file": {
      const path = args.path as string;
      if (!path) return "Error: 'path' is required";
      // Always read from disk — this is what cargo/rustc actually sees.
      // fileState may be stale if edit_file partially failed or files were modified externally.
      try {
        const content = await readProjectFile(projectId, path);
        fileState.set(path, content); // sync memory with disk
        const lines = content.split("\n").length;
        log(`  [read_file] ${path} (${lines} lines)`);
        return content;
      } catch {
        // Fallback to memory if file was never flushed to disk yet
        if (fileState.has(path)) {
          const content = fileState.get(path)!;
          log(`  [read_file] ${path} (${content.split("\n").length} lines, pending write)`);
          return content;
        }
        return `Error: File "${path}" not found`;
      }
    }

    case "edit_file": {
      const path = args.path as string;
      const search = args.search as string;
      const replace = args.replace as string;
      if (!path || search === undefined || replace === undefined) {
        return "Error: 'path', 'search', 'replace' required";
      }
      let content = fileState.get(path);
      if (content === undefined) {
        try {
          content = await readProjectFile(projectId, path);
          fileState.set(path, content);
        } catch {
          return `Error: File "${path}" not found — read it first`;
        }
      }
      try {
        const result = replaceBlock(content, search, replace);
        fileState.set(path, result.updated);
        await writeProjectFile(projectId, path, result.updated);
        log(`  [edit_file] ${path} — ${result.strategy}`);
        return `OK: Edited ${path} (strategy: ${result.strategy})`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  [edit_file] ${path} — FAILED: ${msg}`);
        return `Error: ${msg}. Read the file again to get the exact content.`;
      }
    }

    case "write_file": {
      const path = args.path as string;
      const content = args.content as string;
      if (!path || content === undefined) return "Error: 'path' and 'content' required";
      fileState.set(path, content);
      await writeProjectFile(projectId, path, content);
      log(`  [write_file] ${path} — OK (${content.split("\n").length} lines)`);
      return "OK";
    }

    case "delete_file": {
      const path = args.path as string;
      if (!path) return "Error: 'path' is required";
      fileState.delete(path);
      try {
        await deleteProjectFile(projectId, path);
        log(`  [delete_file] ${path} — deleted from disk`);
      } catch {
        log(`  [delete_file] ${path} — file may not exist on disk, removed from state`);
      }
      return `OK: Deleted ${path}`;
    }

    case "cargo_check": {
      try {
        // Flush all file state to disk before checking (skip deleted files)
        for (const [path, content] of fileState) {
          await writeProjectFile(projectId, path, content);
        }
        const result = await runValidation(projectId, ["cargo check"]);
        if (result.ok) {
          log("  [cargo_check] PASSED");
          return "OK: Compilation successful — all files compile without errors.";
        }
        const errors = [...result.stdout_tail, ...result.stderr_tail].join("\n");
        log(`  [cargo_check] FAILED`);
        // Include file listing so the agent knows which Rust files exist on disk
        const fileList = [...fileState.keys()].filter(p => p.startsWith("src-tauri/")).join(", ");
        return `ERRORS:\n${errors}\n\nCurrent Rust files on disk: ${fileList}\nMake sure there are no duplicate definitions across files.`;
      } catch (err) {
        log(`  [cargo_check] command failed: ${err}`);
        return `Error running cargo check: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    default:
      return `Unknown tool: ${tool}`;
  }
}
