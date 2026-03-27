import { describe, it, expect } from "vitest"
import { dataUrlToBase64, validateImageFile } from "../images.js"

// Minimal 1x1 red PNG as base64
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

describe("dataUrlToBase64", () => {
  it("extracts mime and base64 from a data URL", () => {
    const { mime, base64 } = dataUrlToBase64(TINY_PNG_DATA_URL)
    expect(mime).toBe("image/png")
    expect(base64).toBe(TINY_PNG_B64)
  })

  it("throws on invalid data URL", () => {
    expect(() => dataUrlToBase64("not-a-data-url")).toThrow()
  })
})

describe("validateImageFile", () => {
  it("accepts valid png", () => {
    const file = new File([new Uint8Array(100)], "test.png", { type: "image/png" })
    const result = validateImageFile(file)
    expect(result.ok).toBe(true)
  })

  it("rejects unsupported types", () => {
    const file = new File([new Uint8Array(100)], "test.gif", { type: "image/gif" })
    const result = validateImageFile(file)
    expect(result.ok).toBe(false)
  })

  it("rejects files over max size", () => {
    // Create a File that claims to be large
    const buf = new Uint8Array(100)
    const file = new File([buf], "test.png", { type: "image/png" })
    // Use a tiny max size to test
    const result = validateImageFile(file, 10)
    expect(result.ok).toBe(false)
  })
})
