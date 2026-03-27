// Core barrel – pure functions only (no fs, no process, no DOM)

export { replaceBlock } from "./core/replace.js"
export { parsePatchBlocks } from "./core/patchFormat/blocks.js"
export { parsePatchJson } from "./core/patchFormat/json.js"
export { summarizePlan } from "./core/summarize.js"
export { levenshtein } from "./core/levenshtein.js"
export { normalizeLineEndings, detectLineEnding, convertToLineEnding } from "./core/normalize.js"
export { AmbiguousMatch, NotFound, InvalidPatch, UnsafeCommand, PathTraversal } from "./core/errors.js"
export type { PatchPlan, PatchOp, ReplaceResult, ReplaceOpts, Replacer } from "./core/types.js"
