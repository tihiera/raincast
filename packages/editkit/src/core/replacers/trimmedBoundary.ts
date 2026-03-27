import type { Replacer } from "../types.js"

/** Strategy 6 – tolerate extra leading/trailing blank lines in find. */
export const trimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()
  if (trimmedFind === find) return // already trimmed, nothing extra to try

  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  const lines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}
