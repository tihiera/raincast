import type { Replacer } from "../types.js"
import { levenshtein } from "../levenshtein.js"

const SINGLE_CANDIDATE_THRESHOLD = 0.0
const MULTI_CANDIDATE_THRESHOLD = 0.3

/**
 * Strategy 7 – Block-anchor matching.
 *
 * Anchors on the first and last non-empty lines (trimmed). Scans all candidate
 * blocks in the content whose boundaries match. Scores middle lines via
 * normalised Levenshtein distance.
 */
export const blockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) return
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  const firstSearch = searchLines[0].trim()
  const lastSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect candidates
  const candidates: { startLine: number; endLine: number }[] = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstSearch) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastSearch) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }

  if (candidates.length === 0) return

  function extractSubstring(startLine: number, endLine: number): string {
    let start = 0
    for (let k = 0; k < startLine; k++) start += originalLines[k].length + 1
    let end = start
    for (let k = startLine; k <= endLine; k++) {
      end += originalLines[k].length
      if (k < endLine) end += 1
    }
    return content.substring(start, end)
  }

  function scoreSimilarity(startLine: number, endLine: number): number {
    const actualBlockSize = endLine - startLine + 1
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck <= 0) return 1.0

    let similarity = 0
    for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
      const origLine = originalLines[startLine + j].trim()
      const searchLine = searchLines[j].trim()
      const maxLen = Math.max(origLine.length, searchLine.length)
      if (maxLen === 0) continue
      const dist = levenshtein(origLine, searchLine)
      similarity += (1 - dist / maxLen) / linesToCheck
    }
    return similarity
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    if (scoreSimilarity(startLine, endLine) >= SINGLE_CANDIDATE_THRESHOLD) {
      yield extractSubstring(startLine, endLine)
    }
    return
  }

  // Multiple candidates – pick the best
  let best: { startLine: number; endLine: number } | null = null
  let maxSim = -1
  for (const c of candidates) {
    const sim = scoreSimilarity(c.startLine, c.endLine)
    if (sim > maxSim) {
      maxSim = sim
      best = c
    }
  }
  if (maxSim >= MULTI_CANDIDATE_THRESHOLD && best) {
    yield extractSubstring(best.startLine, best.endLine)
  }
}
