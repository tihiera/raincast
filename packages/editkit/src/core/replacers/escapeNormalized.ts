import type { Replacer } from "../types.js"

function unescape(str: string): string {
  return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (_match, ch: string) => {
    switch (ch) {
      case "n":
        return "\n"
      case "t":
        return "\t"
      case "r":
        return "\r"
      case "'":
        return "'"
      case '"':
        return '"'
      case "`":
        return "`"
      case "\\":
        return "\\"
      case "\n":
        return "\n"
      case "$":
        return "$"
      default:
        return ch
    }
  })
}

/** Strategy 5 – interpret \\n, \\t etc. before matching. */
export const escapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapedFind = unescape(find)

  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try block-level match with unescaped content
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (unescape(block) === unescapedFind) {
      yield block
    }
  }
}
