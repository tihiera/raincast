// ---------------------------------------------------------------------------
// Parse >>>RAIN_EDIT block format
// ---------------------------------------------------------------------------

import type { PatchPlan, PatchOp } from "../types.js"
import { InvalidPatch } from "../errors.js"

const HEADER_RE = /^>>>RAIN_EDIT\s+(.*)/
const ATTR_RE = /(\w+)="([^"]*)"/g

/**
 * Parse the RAIN_EDIT block format into a PatchPlan.
 *
 * ```
 * >>>RAIN_EDIT path="src/foo.ts" kind="replaceBlock" replaceAll="false"
 * >>>OLD
 * ...old...
 * >>>NEW
 * ...new...
 * >>>END
 * ```
 *
 * Also supports writeFile, deleteFile, mkdir:
 * ```
 * >>>RAIN_EDIT path="src/foo.ts" kind="writeFile" create="true"
 * >>>CONTENT
 * ...content...
 * >>>END
 * ```
 */
export function parsePatchBlocks(text: string): PatchPlan {
  const lines = text.split("\n")
  const ops: PatchOp[] = []
  let i = 0

  while (i < lines.length) {
    const headerMatch = lines[i].match(HEADER_RE)
    if (!headerMatch) {
      i++
      continue
    }

    const attrs: Record<string, string> = {}
    let m: RegExpExecArray | null
    const attrStr = headerMatch[1]
    const re = new RegExp(ATTR_RE.source, "g")
    while ((m = re.exec(attrStr)) !== null) {
      attrs[m[1]] = m[2]
    }

    const kind = attrs["kind"]
    const filePath = attrs["path"]
    if (!kind) throw new InvalidPatch(`Missing kind= attribute at line ${i + 1}`)
    if (!filePath && kind !== "mkdir") throw new InvalidPatch(`Missing path= attribute at line ${i + 1}`)

    i++ // move past header

    if (kind === "replaceBlock") {
      // Expect >>>OLD ... >>>NEW ... >>>END
      if (i >= lines.length || lines[i].trim() !== ">>>OLD")
        throw new InvalidPatch(`Expected >>>OLD at line ${i + 1}`)
      i++
      const oldLines: string[] = []
      while (i < lines.length && lines[i].trim() !== ">>>NEW") {
        oldLines.push(lines[i])
        i++
      }
      if (i >= lines.length) throw new InvalidPatch("Unterminated block: missing >>>NEW")
      i++ // skip >>>NEW
      const newLines: string[] = []
      while (i < lines.length && lines[i].trim() !== ">>>END") {
        newLines.push(lines[i])
        i++
      }
      if (i >= lines.length) throw new InvalidPatch("Unterminated block: missing >>>END")
      i++ // skip >>>END

      ops.push({
        kind: "replaceBlock",
        path: filePath,
        old: oldLines.join("\n"),
        new: newLines.join("\n"),
        replaceAll: attrs["replaceAll"] === "true",
      })
    } else if (kind === "writeFile") {
      if (i >= lines.length || lines[i].trim() !== ">>>CONTENT")
        throw new InvalidPatch(`Expected >>>CONTENT at line ${i + 1}`)
      i++
      const contentLines: string[] = []
      while (i < lines.length && lines[i].trim() !== ">>>END") {
        contentLines.push(lines[i])
        i++
      }
      if (i >= lines.length) throw new InvalidPatch("Unterminated block: missing >>>END")
      i++
      ops.push({
        kind: "writeFile",
        path: filePath,
        content: contentLines.join("\n"),
        create: attrs["create"] === "true",
      })
    } else if (kind === "deleteFile") {
      // Expect >>>END
      if (i >= lines.length || lines[i].trim() !== ">>>END")
        throw new InvalidPatch(`Expected >>>END at line ${i + 1}`)
      i++
      ops.push({ kind: "deleteFile", path: filePath })
    } else if (kind === "mkdir") {
      if (!filePath) throw new InvalidPatch(`Missing path= attribute for mkdir at line ${i}`)
      if (i >= lines.length || lines[i].trim() !== ">>>END")
        throw new InvalidPatch(`Expected >>>END at line ${i + 1}`)
      i++
      ops.push({ kind: "mkdir", path: filePath })
    } else {
      throw new InvalidPatch(`Unknown kind "${kind}" at line ${i}`)
    }
  }

  if (ops.length === 0) throw new InvalidPatch("No RAIN_EDIT blocks found")

  return { id: crypto.randomUUID(), ops }
}
