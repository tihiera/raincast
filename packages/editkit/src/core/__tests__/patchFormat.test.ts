import { describe, it, expect } from "vitest"
import { parsePatchBlocks } from "../patchFormat/blocks.js"
import { parsePatchJson } from "../patchFormat/json.js"
import { InvalidPatch } from "../errors.js"

describe("parsePatchBlocks", () => {
  it("parses a single replaceBlock", () => {
    const text = `
>>>RAIN_EDIT path="src/foo.ts" kind="replaceBlock" replaceAll="false"
>>>OLD
const x = 1
>>>NEW
const x = 2
>>>END
`.trim()
    const plan = parsePatchBlocks(text)
    expect(plan.ops).toHaveLength(1)
    expect(plan.ops[0].kind).toBe("replaceBlock")
    if (plan.ops[0].kind === "replaceBlock") {
      expect(plan.ops[0].old).toBe("const x = 1")
      expect(plan.ops[0].new).toBe("const x = 2")
    }
  })

  it("parses multiple blocks", () => {
    const text = `
>>>RAIN_EDIT path="a.ts" kind="replaceBlock"
>>>OLD
aaa
>>>NEW
bbb
>>>END
>>>RAIN_EDIT path="b.ts" kind="writeFile" create="true"
>>>CONTENT
hello
>>>END
>>>RAIN_EDIT path="c.ts" kind="deleteFile"
>>>END
`.trim()
    const plan = parsePatchBlocks(text)
    expect(plan.ops).toHaveLength(3)
    expect(plan.ops[0].kind).toBe("replaceBlock")
    expect(plan.ops[1].kind).toBe("writeFile")
    expect(plan.ops[2].kind).toBe("deleteFile")
  })

  it("throws on malformed block", () => {
    expect(() => parsePatchBlocks("nothing here")).toThrow(InvalidPatch)
  })
})

describe("parsePatchJson", () => {
  it("parses raw JSON", () => {
    const json = JSON.stringify({
      ops: [{ kind: "replaceBlock", path: "x.ts", old: "a", new: "b" }],
    })
    const plan = parsePatchJson(json)
    expect(plan.ops).toHaveLength(1)
  })

  it("parses JSON inside a fenced code block", () => {
    const text = "```json\n" + JSON.stringify({ ops: [{ kind: "mkdir", path: "lib" }] }) + "\n```"
    const plan = parsePatchJson(text)
    expect(plan.ops[0].kind).toBe("mkdir")
  })

  it("throws on invalid JSON", () => {
    expect(() => parsePatchJson("not json")).toThrow(InvalidPatch)
  })
})
