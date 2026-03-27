import type { Replacer } from "../types.js"

function removeIndentation(text: string): string {
  const lines = text.split("\n")
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length === 0) return text
  const minIndent = Math.min(
    ...nonEmpty.map((l) => {
      const m = l.match(/^(\s*)/)
      return m ? m[1].length : 0
    }),
  )
  return lines.map((l) => (l.trim().length === 0 ? l : l.slice(minIndent))).join("\n")
}

/** Strategy 3 – ignore common leading indentation. */
export const indentationFlexibleReplacer: Replacer = function* (content, find) {
  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}
