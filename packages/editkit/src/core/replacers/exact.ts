import type { Replacer } from "../types.js"

/** Strategy 1 – exact substring match. */
export const exactReplacer: Replacer = function* (_content, find) {
  yield find
}
