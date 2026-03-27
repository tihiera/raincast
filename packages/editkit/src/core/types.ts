// ---------------------------------------------------------------------------
// Core types for @rain/editkit
// ---------------------------------------------------------------------------

/** A single operation inside a patch plan. */
export type PatchOp =
  | { kind: "replaceBlock"; path: string; old: string; new: string; replaceAll?: boolean }
  | { kind: "writeFile"; path: string; content: string; create?: boolean }
  | { kind: "deleteFile"; path: string }
  | { kind: "mkdir"; path: string }

/** A complete patch plan that can be applied atomically. */
export interface PatchPlan {
  id: string
  projectId?: string
  ops: PatchOp[]
}

/** The result of a successful replaceBlock call. */
export interface ReplaceResult {
  updated: string
  strategy: string
  matchCount: number
}

/** Options for replaceBlock. */
export interface ReplaceOpts {
  replaceAll?: boolean
}

/**
 * A Replacer is a generator that, given the full file content and the search
 * string, yields candidate substrings of `content` that should be considered
 * matches. The caller is responsible for deciding ambiguity / replaceAll.
 */
export type Replacer = (content: string, find: string) => Generator<string, void, unknown>
