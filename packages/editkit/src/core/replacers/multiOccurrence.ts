import type { Replacer } from "../types.js"

/** Strategy 8 – yield every exact occurrence (for replaceAll support). */
export const multiOccurrenceReplacer: Replacer = function* (content, find) {
  let start = 0
  while (true) {
    const idx = content.indexOf(find, start)
    if (idx === -1) break
    yield find
    start = idx + find.length
  }
}
