// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

/** Collapse \r\n → \n */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

/** Detect the dominant line ending used in the text. */
export function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

/** Convert all line endings in `text` to `ending`. */
export function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  const normalized = normalizeLineEndings(text)
  if (ending === "\n") return normalized
  return normalized.replaceAll("\n", "\r\n")
}
