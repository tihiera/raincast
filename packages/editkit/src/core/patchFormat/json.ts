// ---------------------------------------------------------------------------
// Parse PatchPlan JSON (possibly fenced)
// ---------------------------------------------------------------------------

import type { PatchPlan, PatchOp } from "../types.js"
import { InvalidPatch } from "../errors.js"

const FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)```/

/**
 * Parse a PatchPlan from raw JSON or from JSON inside a fenced code block.
 */
export function parsePatchJson(text: string): PatchPlan {
  let raw = text.trim()

  // Try to extract from fenced block
  const fenceMatch = raw.match(FENCE_RE)
  if (fenceMatch) raw = fenceMatch[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InvalidPatch("Failed to parse JSON patch plan")
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as any).ops)) {
    throw new InvalidPatch("Patch plan must be an object with an ops array")
  }

  const obj = parsed as Record<string, unknown>
  const ops = (obj.ops as unknown[]).map((op, idx) => validateOp(op, idx))

  return {
    id: typeof obj.id === "string" ? obj.id : crypto.randomUUID(),
    projectId: typeof obj.projectId === "string" ? obj.projectId : undefined,
    ops,
  }
}

function validateOp(op: unknown, idx: number): PatchOp {
  if (typeof op !== "object" || op === null) throw new InvalidPatch(`ops[${idx}] must be an object`)
  const o = op as Record<string, unknown>
  const kind = o.kind
  if (typeof kind !== "string") throw new InvalidPatch(`ops[${idx}].kind must be a string`)

  switch (kind) {
    case "replaceBlock":
      if (typeof o.path !== "string") throw new InvalidPatch(`ops[${idx}].path required`)
      if (typeof o.old !== "string") throw new InvalidPatch(`ops[${idx}].old required`)
      if (typeof o.new !== "string") throw new InvalidPatch(`ops[${idx}].new required`)
      return {
        kind: "replaceBlock",
        path: o.path,
        old: o.old,
        new: o.new,
        replaceAll: o.replaceAll === true,
      }
    case "writeFile":
      if (typeof o.path !== "string") throw new InvalidPatch(`ops[${idx}].path required`)
      if (typeof o.content !== "string") throw new InvalidPatch(`ops[${idx}].content required`)
      return { kind: "writeFile", path: o.path, content: o.content, create: o.create === true }
    case "deleteFile":
      if (typeof o.path !== "string") throw new InvalidPatch(`ops[${idx}].path required`)
      return { kind: "deleteFile", path: o.path }
    case "mkdir":
      if (typeof o.path !== "string") throw new InvalidPatch(`ops[${idx}].path required`)
      return { kind: "mkdir", path: o.path }
    default:
      throw new InvalidPatch(`ops[${idx}]: unknown kind "${kind}"`)
  }
}
