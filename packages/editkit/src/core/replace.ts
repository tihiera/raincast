// ---------------------------------------------------------------------------
// replaceBlock – the core multi-strategy search/replace engine
// ---------------------------------------------------------------------------

import type { Replacer, ReplaceOpts, ReplaceResult } from "./types.js"
import { AmbiguousMatch, InvalidPatch, NotFound } from "./errors.js"
import { normalizeLineEndings, detectLineEnding, convertToLineEnding } from "./normalize.js"
import { exactReplacer } from "./replacers/exact.js"
import { lineTrimmedReplacer } from "./replacers/lineTrimmed.js"
import { indentationFlexibleReplacer } from "./replacers/indentationFlexible.js"
import { whitespaceNormalizedReplacer } from "./replacers/whitespaceNormalized.js"
import { escapeNormalizedReplacer } from "./replacers/escapeNormalized.js"
import { trimmedBoundaryReplacer } from "./replacers/trimmedBoundary.js"
import { blockAnchorReplacer } from "./replacers/blockAnchor.js"
import { multiOccurrenceReplacer } from "./replacers/multiOccurrence.js"

const STRATEGY_CHAIN: { name: string; fn: Replacer }[] = [
  { name: "exact", fn: exactReplacer },
  { name: "lineTrimmed", fn: lineTrimmedReplacer },
  { name: "indentationFlexible", fn: indentationFlexibleReplacer },
  { name: "whitespaceNormalized", fn: whitespaceNormalizedReplacer },
  { name: "escapeNormalized", fn: escapeNormalizedReplacer },
  { name: "trimmedBoundary", fn: trimmedBoundaryReplacer },
  { name: "blockAnchor", fn: blockAnchorReplacer },
  { name: "multiOccurrence", fn: multiOccurrenceReplacer },
]

/**
 * Replace `oldText` with `newText` inside `content` using a chain of
 * increasingly fuzzy replacer strategies.
 *
 * Throws:
 * - `InvalidPatch` when oldText is empty
 * - `AmbiguousMatch` when multiple matches and replaceAll is false
 * - `NotFound` when no strategy finds a match
 */
export function replaceBlock(content: string, oldText: string, newText: string, opts?: ReplaceOpts): ReplaceResult {
  if (oldText === "") throw new InvalidPatch("oldText must not be empty")

  const ending = detectLineEnding(content)
  const normOld = convertToLineEnding(normalizeLineEndings(oldText), ending)
  const normNew = convertToLineEnding(normalizeLineEndings(newText), ending)

  const replaceAll = opts?.replaceAll ?? false

  for (const { name, fn } of STRATEGY_CHAIN) {
    for (const search of fn(content, normOld)) {
      const firstIdx = content.indexOf(search)
      if (firstIdx === -1) continue

      if (replaceAll) {
        // Count occurrences
        let count = 0
        let pos = 0
        while (true) {
          const idx = content.indexOf(search, pos)
          if (idx === -1) break
          count++
          pos = idx + search.length
        }
        return {
          updated: content.replaceAll(search, normNew),
          strategy: name,
          matchCount: count,
        }
      }

      // Single-replace mode: ambiguity check
      const lastIdx = content.lastIndexOf(search)
      if (firstIdx !== lastIdx) {
        // Multiple occurrences – count them and throw
        let count = 0
        let pos = 0
        while (true) {
          const idx = content.indexOf(search, pos)
          if (idx === -1) break
          count++
          pos = idx + search.length
        }
        throw new AmbiguousMatch(count)
      }

      return {
        updated: content.substring(0, firstIdx) + normNew + content.substring(firstIdx + search.length),
        strategy: name,
        matchCount: 1,
      }
    }
  }

  throw new NotFound()
}
