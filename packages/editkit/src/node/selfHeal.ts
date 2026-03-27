import type { PatchPlan } from "../core/types.js"
import type { ValidationResult } from "./validate.js"
import { summarizePlan } from "../core/summarize.js"
import { applyPatchPlan } from "./applyPlan.js"
import { runValidation } from "./validate.js"

export interface SelfHealContext {
  stdoutTail: string
  stderrTail: string
  planSummary: string
  changedFiles: string[]
  iteration: number
}

export interface SelfHealOpts {
  root: string
  initialPlan: PatchPlan
  validateCommands: string[]
  /** Injected by the app – must NOT call any LLM directly. */
  proposeFix: (ctx: SelfHealContext) => Promise<PatchPlan>
  maxIters?: number
  onIteration?: (ctx: { iteration: number; validation: ValidationResult; plan: PatchPlan }) => void
}

export interface SelfHealResult {
  ok: boolean
  iters: number
  lastValidation: ValidationResult
  snapshots: string[]
}

/**
 * Self-healing loop primitive.
 *
 * Applies a plan, validates, and if validation fails calls the injected
 * `proposeFix` callback to get a new plan. Repeats up to `maxIters` times.
 *
 * This function intentionally does NOT call any LLM – `proposeFix` is
 * provided by the consuming application.
 */
export async function runSelfHeal(opts: SelfHealOpts): Promise<SelfHealResult> {
  const { root, validateCommands, proposeFix, maxIters = 5, onIteration } = opts
  let currentPlan = opts.initialPlan
  const snapshots: string[] = []

  for (let iter = 1; iter <= maxIters; iter++) {
    // Apply
    const { snapshotId, changedFiles } = applyPatchPlan(root, currentPlan)
    snapshots.push(snapshotId)

    // Validate
    const validation = runValidation(root, validateCommands)
    onIteration?.({ iteration: iter, validation, plan: currentPlan })

    if (validation.ok) {
      return { ok: true, iters: iter, lastValidation: validation, snapshots }
    }

    // Build minimal context for proposeFix
    if (iter < maxIters) {
      const ctx: SelfHealContext = {
        stdoutTail: validation.stdoutTail,
        stderrTail: validation.stderrTail,
        planSummary: summarizePlan(currentPlan),
        changedFiles,
        iteration: iter,
      }
      currentPlan = await proposeFix(ctx)
    } else {
      return { ok: false, iters: iter, lastValidation: validation, snapshots }
    }
  }

  // Should not reach here, but just in case
  return {
    ok: false,
    iters: maxIters,
    lastValidation: { ok: false, exitCode: 1, stdoutTail: "", stderrTail: "" },
    snapshots,
  }
}
