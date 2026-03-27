import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { replaceBlock } from "../core/replace.js"
import { resolveWithinRoot } from "./safePath.js"
import { createSnapshot } from "./snapshot.js"
import type { PatchPlan } from "../core/types.js"

export interface ApplyResult {
  snapshotId: string
  changedFiles: string[]
}

/**
 * Apply a PatchPlan to the filesystem with atomic writes and pre-snapshot.
 */
export function applyPatchPlan(root: string, plan: PatchPlan): ApplyResult {
  // 1. Determine all touched files
  const touchedSet = new Set<string>()
  for (const op of plan.ops) {
    if (op.kind !== "mkdir") touchedSet.add(op.path)
  }
  const touchedFiles = [...touchedSet]

  // 2. Create snapshot BEFORE writing
  const snapshotId = createSnapshot(root, touchedFiles, { planId: plan.id })

  // 3. Execute ops
  const changedFiles: string[] = []
  try {
    for (const op of plan.ops) {
      switch (op.kind) {
        case "replaceBlock": {
          const abs = resolveWithinRoot(root, op.path)
          const content = fs.readFileSync(abs, "utf-8")
          const result = replaceBlock(content, op.old, op.new, { replaceAll: op.replaceAll })
          atomicWrite(abs, result.updated)
          changedFiles.push(op.path)
          break
        }
        case "writeFile": {
          const abs = resolveWithinRoot(root, op.path)
          fs.mkdirSync(path.dirname(abs), { recursive: true })
          atomicWrite(abs, op.content)
          changedFiles.push(op.path)
          break
        }
        case "deleteFile": {
          const abs = resolveWithinRoot(root, op.path)
          fs.unlinkSync(abs)
          changedFiles.push(op.path)
          break
        }
        case "mkdir": {
          const abs = resolveWithinRoot(root, op.path)
          fs.mkdirSync(abs, { recursive: true })
          break
        }
      }
    }
  } catch (e) {
    // If any op fails, we leave the snapshot in place so the caller can restore
    throw e
  }

  return { snapshotId, changedFiles }
}

/** Write to a temp file then rename for atomicity. */
function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + "." + crypto.randomBytes(6).toString("hex") + ".tmp"
  fs.writeFileSync(tmp, content, "utf-8")
  fs.renameSync(tmp, filePath)
}
