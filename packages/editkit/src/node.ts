// Node barrel – filesystem + child_process helpers

export { resolveWithinRoot } from "./node/safePath.js"
export { createSnapshot, restoreSnapshot } from "./node/snapshot.js"
export { applyPatchPlan } from "./node/applyPlan.js"
export { runValidation } from "./node/validate.js"
export { runSelfHeal } from "./node/selfHeal.js"
export type { SnapshotManifest } from "./node/snapshot.js"
export type { ApplyResult } from "./node/applyPlan.js"
export type { ValidationResult } from "./node/validate.js"
export type { SelfHealOpts, SelfHealResult, SelfHealContext } from "./node/selfHeal.js"
