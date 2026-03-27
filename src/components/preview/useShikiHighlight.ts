import { useState, useEffect, useRef } from "react";
import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

// Map file extensions to Shiki language IDs
function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    css: "css",
    html: "html",
    json: "json",
    md: "markdown",
    rs: "rust",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    svg: "html",
  };
  return map[ext] ?? "text";
}

// Extract the code portion from a log line like "  │   1 │ const x = 1"
function extractCode(line: string): string {
  const match = line.match(/^\s+│\s+\d+\s+│\s?(.*)/);
  return match ? match[1] : line;
}

/**
 * Processes generation logs to produce per-line highlighted HTML
 * for file content lines. Returns a Map<lineIndex, htmlString>.
 */
export function useShikiHighlight(logs: string[], isDark: boolean) {
  const [highlightMap, setHighlightMap] = useState<Map<number, string>>(new Map());
  const highlighterRef = useRef<Highlighter | null>(null);
  const pendingRef = useRef(0);

  // Init highlighter once
  useEffect(() => {
    let cancelled = false;
    createHighlighter({
      themes: ["github-dark-default", "github-light-default"],
      langs: ["typescript", "tsx", "javascript", "jsx", "css", "html", "json", "markdown", "text"],
    }).then((h) => {
      if (!cancelled) highlighterRef.current = h;
    });
    return () => { cancelled = true; };
  }, []);

  // Process logs when they change (debounced to avoid thrashing during generation)
  useEffect(() => {
    const h = highlighterRef.current;
    if (!h || logs.length === 0) return;

    const id = ++pendingRef.current;
    const timer = setTimeout(() => processLogs(h, id), 300);
    return () => clearTimeout(timer);

    function processLogs(h: Highlighter, id: number) {

    // Find file blocks and batch-highlight them
    const blocks: { startIdx: number; path: string; lines: string[] }[] = [];
    let currentBlock: { startIdx: number; path: string; lines: string[] } | null = null;

    for (let i = 0; i < logs.length; i++) {
      const line = logs[i];
      if (line.startsWith("  ┌── ")) {
        const pathMatch = line.match(/^\s+┌──\s+(.+?)\s+──$/);
        if (pathMatch) {
          currentBlock = { startIdx: i + 1, path: pathMatch[1], lines: [] };
        }
      } else if (line.startsWith("  └──") && currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      } else if (currentBlock && line.startsWith("  │ ")) {
        currentBlock.lines.push(extractCode(line));
      }
    }

    // Highlight each block
    const newMap = new Map<number, string>();
    const theme = isDark ? "github-dark-default" : "github-light-default";

    for (const block of blocks) {
      const lang = langFromPath(block.path);
      const code = block.lines.join("\n");

      try {
        const tokens = h.codeToTokens(code, { lang: lang as BundledLanguage, theme });
        // Map each line's tokens back to the original log index
        for (let lineIdx = 0; lineIdx < tokens.tokens.length; lineIdx++) {
          const logIdx = block.startIdx + lineIdx;
          const lineTokens = tokens.tokens[lineIdx];
          const html = lineTokens
            .map((t) => {
              const escaped = t.content
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              return t.color
                ? `<span style="color:${t.color}">${escaped}</span>`
                : escaped;
            })
            .join("");
          newMap.set(logIdx, html);
        }
      } catch {
        // If highlighting fails for a block, skip it
      }
    }

    if (pendingRef.current === id) {
      setHighlightMap(newMap);
    }
    } // end processLogs
  }, [logs, isDark]);

  return highlightMap;
}
