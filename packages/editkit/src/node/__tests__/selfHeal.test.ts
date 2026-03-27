import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { runSelfHeal } from "../selfHeal.js"
import type { PatchPlan } from "../../core/types.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rain-heal-"))
  // Create a valid TS file and package.json so node can validate
  fs.writeFileSync(
    path.join(tmpDir, "check.js"),
    `
const fs = require("fs");
const code = fs.readFileSync(__dirname + "/main.ts", "utf-8");
if (code.includes("BROKEN")) { process.exit(1); }
process.exit(0);
`.trim(),
  )
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("runSelfHeal", () => {
  it("initial plan introduces error, proposeFix fixes it, loop succeeds within 2 iters", async () => {
    // Existing file
    fs.writeFileSync(path.join(tmpDir, "main.ts"), "const x = 1")

    // Initial plan writes a broken file
    const initialPlan: PatchPlan = {
      id: "plan-1",
      ops: [{ kind: "replaceBlock", path: "main.ts", old: "const x = 1", new: "const x = BROKEN" }],
    }

    let fixCalled = false
    const result = await runSelfHeal({
      root: tmpDir,
      initialPlan,
      validateCommands: ["node check.js"],
      proposeFix: async (_ctx) => {
        fixCalled = true
        return {
          id: "plan-2",
          ops: [{ kind: "replaceBlock", path: "main.ts", old: "const x = BROKEN", new: "const x = 42" }],
        }
      },
      maxIters: 5,
    })

    expect(fixCalled).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.iters).toBe(2)
    expect(fs.readFileSync(path.join(tmpDir, "main.ts"), "utf-8")).toBe("const x = 42")
  })
})
