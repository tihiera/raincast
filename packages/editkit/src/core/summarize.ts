import type { PatchPlan } from "./types.js"

/**
 * Produce a short, stable summary of a patch plan – useful as minimal context
 * for the self-heal loop.
 */
export function summarizePlan(plan: PatchPlan): string {
  const paths = [...new Set(plan.ops.map((op) => op.path))]
  const kindCounts: Record<string, number> = {}
  for (const op of plan.ops) {
    kindCounts[op.kind] = (kindCounts[op.kind] ?? 0) + 1
  }
  const kinds = Object.entries(kindCounts)
    .map(([k, v]) => `${v}×${k}`)
    .join(", ")
  return `PatchPlan(${plan.ops.length} ops: ${kinds}) touching ${paths.length} file(s): ${paths.join(", ")}`
}
