import { describe, it, expect } from "vitest"
import { levenshtein } from "../levenshtein.js"

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
  })

  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })

  it("calculates distance correctly", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
    expect(levenshtein("saturday", "sunday")).toBe(3)
  })
})
