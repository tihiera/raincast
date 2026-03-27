import type { Replacer } from "../types.js"

const norm = (t: string) => t.replace(/\s+/g, " ").trim()

/** Strategy 4 – collapse all whitespace runs to single space, then compare. */
export const whitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizedFind = norm(find)
  const lines = content.split("\n")

  // Single-line matches
  for (const line of lines) {
    if (norm(line) === normalizedFind) {
      yield line
    } else {
      const normalizedLine = norm(line)
      if (normalizedLine.includes(normalizedFind)) {
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const match = line.match(new RegExp(pattern))
            if (match) yield match[0]
          } catch {
            // invalid regex – skip
          }
        }
      }
    }
  }

  // Multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (norm(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}
