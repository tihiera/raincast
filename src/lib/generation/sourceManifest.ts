/**
 * Source manifest — lightweight plain-English summaries of each source file.
 *
 * Instead of reading all source files (~5000+ lines) and sending them to the LLM
 * for every edit, we maintain a manifest that describes what each file does
 * AND what each function/component inside it does.
 *
 * A 500-line file with 20 functions becomes ~25 lines of manifest:
 *   • src/utils/helpers.ts — Utility functions for data formatting
 *       formatDate(date) → string — Formats date into display format
 *       validateEmail(email) → boolean — Checks RFC email pattern
 *       ...
 *
 * Generated after each build/edit using the fast model.
 */

import type { AiProvider } from "../ai/types";

export interface FileSummary {
  description: string;
  /** One-line summary per exported function/component/constant */
  members: Array<{ name: string; signature: string; description: string }>;
}

export interface SourceManifest {
  files: Record<string, FileSummary>;
  generatedAt: number;
}

/**
 * Generate a source manifest from file contents using the fast model.
 * Each file gets a description + per-function summaries.
 */
export async function generateSourceManifest(
  provider: AiProvider,
  files: Record<string, string>,
): Promise<SourceManifest> {
  const filePaths = Object.keys(files);
  if (filePaths.length === 0) {
    return { files: {}, generatedAt: Date.now() };
  }

  // Build the prompt with file contents (truncated for very large files)
  const fileBlocks = filePaths.map((path) => {
    const content = files[path];
    const lines = content.split("\n");
    const truncated = lines.length > 100
      ? lines.slice(0, 100).join("\n") + `\n... (${lines.length - 100} more lines)`
      : content;
    return `=== ${path} ===\n${truncated}`;
  }).join("\n\n");

  const system = `You are a code analyst. Given source files, produce a JSON object describing each file and its key members (functions, components, constants, hooks).

For each file, return:
- "description": what the file does overall (one sentence, under 100 chars)
- "members": array of { "name", "signature", "description" } for each exported or important function/component

For members:
- "name": the function/component/hook name (e.g. "Header", "formatDate", "useTheme")
- "signature": short type signature (e.g. "(date: Date) → string", "(props: { title: string }) → JSX", "constant: ThemeConfig")
- "description": what it does in plain English (under 80 chars). If it renders/displays the app name or title, mention it.

Only include members that are meaningful — skip trivial helpers, type imports, or internal implementation details. Aim for 2-8 members per file.

Return ONLY JSON: { "path/to/file.tsx": { "description": "...", "members": [...] }, ... }`;

  const user = `Summarize these ${filePaths.length} source files:\n\n${fileBlocks}`;

  try {
    const raw = await provider.rawGenerate({ system, user, json: true, model: "fast" });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, { description?: string; members?: Array<{ name?: string; signature?: string; description?: string }> }>;

    const manifest: Record<string, FileSummary> = {};
    for (const path of filePaths) {
      const entry = parsed[path];
      if (entry && entry.description) {
        manifest[path] = {
          description: entry.description,
          members: (entry.members || [])
            .filter((m) => m.name && m.description)
            .map((m) => ({
              name: m.name!,
              signature: m.signature || "",
              description: m.description!,
            })),
        };
      } else {
        manifest[path] = fallbackSummary(path);
      }
    }

    return { files: manifest, generatedAt: Date.now() };
  } catch {
    // Fallback: generate simple summaries from file names
    const manifest: Record<string, FileSummary> = {};
    for (const path of filePaths) {
      manifest[path] = fallbackSummary(path);
    }
    return { files: manifest, generatedAt: Date.now() };
  }
}

function fallbackSummary(path: string): FileSummary {
  const name = path.split("/").pop() || path;
  return { description: `Source file: ${name}`, members: [] };
}

/** Format a manifest into a readable string for the agent prompt. */
export function formatManifest(manifest: SourceManifest): string {
  const entries = Object.entries(manifest.files);
  if (entries.length === 0) return "(no source files)";

  return entries.map(([path, summary]) => {
    let line = `• ${path} — ${summary.description}`;
    if (summary.members.length > 0) {
      const memberLines = summary.members.map((m) => {
        const sig = m.signature ? ` ${m.signature}` : "";
        return `    ${m.name}${sig} — ${m.description}`;
      });
      line += "\n" + memberLines.join("\n");
    }
    return line;
  }).join("\n\n");
}

/** Update a manifest after an edit — only re-summarize changed files. */
export async function updateManifest(
  provider: AiProvider,
  existing: SourceManifest,
  changedFiles: Record<string, string>,
): Promise<SourceManifest> {
  if (Object.keys(changedFiles).length === 0) return existing;

  const partial = await generateSourceManifest(provider, changedFiles);

  return {
    files: { ...existing.files, ...partial.files },
    generatedAt: Date.now(),
  };
}
