// ---------------------------------------------------------------------------
// Minimal Levenshtein distance (no dependencies)
// ---------------------------------------------------------------------------

/**
 * Classic DP Levenshtein. O(n*m) time / O(min(n,m)) space via single-row trick.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Ensure a is the shorter string for O(min) space
  if (a.length > b.length) [a, b] = [b, a]

  const aLen = a.length
  const bLen = b.length
  let prev = new Array<number>(aLen + 1)
  let curr = new Array<number>(aLen + 1)

  for (let i = 0; i <= aLen; i++) prev[i] = i

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[aLen]
}
