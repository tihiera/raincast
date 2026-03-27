import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createSnapshot, restoreSnapshot } from "../snapshot.js"
import { applyPatchPlan } from "../applyPlan.js"
import { resolveWithinRoot } from "../safePath.js"
import { PathTraversal } from "../../core/errors.js"
import type { PatchPlan } from "../../core/types.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rain-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("snapshot + restore", () => {
  it("creates snapshot then restores to original after modification", () => {
    const file = "test.txt"
    const abs = path.join(tmpDir, file)
    fs.writeFileSync(abs, "original content")

    const id = createSnapshot(tmpDir, [file])

    // Modify the file
    fs.writeFileSync(abs, "modified content")
    expect(fs.readFileSync(abs, "utf-8")).toBe("modified content")

    // Restore
    restoreSnapshot(tmpDir, id)
    expect(fs.readFileSync(abs, "utf-8")).toBe("original content")
  })

  it("deletes files that were created after snapshot", () => {
    const file = "new-file.txt"
    const abs = path.join(tmpDir, file)

    // Snapshot when file doesn't exist
    const id = createSnapshot(tmpDir, [file])

    // Create the file after snapshot
    fs.writeFileSync(abs, "should be removed")
    expect(fs.existsSync(abs)).toBe(true)

    // Restore – should delete it
    restoreSnapshot(tmpDir, id)
    expect(fs.existsSync(abs)).toBe(false)
  })
})

describe("applyPatchPlan", () => {
  it("creates snapshot and writes atomically", () => {
    const file = "code.ts"
    const abs = path.join(tmpDir, file)
    fs.writeFileSync(abs, "const x = 1")

    const plan: PatchPlan = {
      id: "test-plan",
      ops: [{ kind: "replaceBlock", path: file, old: "const x = 1", new: "const x = 2" }],
    }

    const result = applyPatchPlan(tmpDir, plan)
    expect(result.changedFiles).toContain(file)
    expect(fs.readFileSync(abs, "utf-8")).toBe("const x = 2")

    // Restore snapshot should bring back original
    restoreSnapshot(tmpDir, result.snapshotId)
    expect(fs.readFileSync(abs, "utf-8")).toBe("const x = 1")
  })
})

describe("resolveWithinRoot", () => {
  it("blocks ../ traversal", () => {
    expect(() => resolveWithinRoot(tmpDir, "../etc/passwd")).toThrow(PathTraversal)
  })

  it("blocks absolute paths", () => {
    expect(() => resolveWithinRoot(tmpDir, "/etc/passwd")).toThrow(PathTraversal)
  })

  it("blocks null bytes", () => {
    expect(() => resolveWithinRoot(tmpDir, "foo\0bar")).toThrow(PathTraversal)
  })

  it("allows valid relative paths", () => {
    const result = resolveWithinRoot(tmpDir, "src/foo.ts")
    // On macOS, tmpDir may be /var/... but resolveWithinRoot uses realpath (/private/var/...)
    expect(result).toContain("src/foo.ts")
    expect(path.isAbsolute(result)).toBe(true)
  })
})
