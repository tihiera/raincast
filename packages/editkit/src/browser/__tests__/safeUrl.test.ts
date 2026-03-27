import { describe, it, expect } from "vitest"
import { isProbablyUiMockInstruction } from "../safeUrl.js"

describe("isProbablyUiMockInstruction", () => {
  it("detects screenshot instruction", () => {
    expect(isProbablyUiMockInstruction("make the UI look like this screenshot")).toBe(true)
  })

  it("detects mockup reference", () => {
    expect(isProbablyUiMockInstruction("implement the layout from the mockup")).toBe(true)
  })

  it("detects figma reference", () => {
    expect(isProbablyUiMockInstruction("match the figma design")).toBe(true)
  })

  it("returns false for non-UI text", () => {
    expect(isProbablyUiMockInstruction("refactor the database module")).toBe(false)
  })
})
