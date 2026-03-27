// ---------------------------------------------------------------------------
// Request builders (provider-agnostic)
// ---------------------------------------------------------------------------

import { RAIN_GEN_SYSTEM_PROMPT, RAIN_UI_FROM_IMAGE_SYSTEM_PROMPT } from "./systemPrompts.js"
import { patchPlanJsonSchema, patchBlocksFormatDescription } from "./toolSchemas.js"

export type OutputFormat = "blocks" | "json"

export interface ImagePayload {
  mime: string
  base64: string
}

export interface TextOnlyRequestOpts {
  userText: string
  repoHints?: string
  outputFormat?: OutputFormat
}

export interface UiFromImageRequestOpts {
  userText: string
  images: ImagePayload[]
  repoHints?: string
  outputFormat?: OutputFormat
}

export interface LlmRequest {
  system: string
  user: string
  images?: ImagePayload[]
  tools?: Record<string, unknown>
  expectedFormat: OutputFormat
}

/**
 * Build a provider-agnostic request for text-only code generation / editing.
 */
export function buildTextOnlyRequest(opts: TextOnlyRequestOpts): LlmRequest {
  const fmt: OutputFormat = opts.outputFormat ?? "blocks"
  const user = opts.repoHints
    ? `<repo-context>\n${opts.repoHints}\n</repo-context>\n\n${opts.userText}`
    : opts.userText

  return {
    system: RAIN_GEN_SYSTEM_PROMPT,
    user,
    expectedFormat: fmt,
    ...(fmt === "json" ? { tools: { patchPlan: patchPlanJsonSchema } } : {}),
  }
}

/**
 * Build a provider-agnostic request for UI-from-image generation.
 */
export function buildUiFromImageRequest(opts: UiFromImageRequestOpts): LlmRequest {
  const fmt: OutputFormat = opts.outputFormat ?? "blocks"
  const user = opts.repoHints
    ? `<repo-context>\n${opts.repoHints}\n</repo-context>\n\n${opts.userText}`
    : opts.userText

  return {
    system: RAIN_UI_FROM_IMAGE_SYSTEM_PROMPT,
    user,
    images: opts.images,
    expectedFormat: fmt,
    ...(fmt === "json" ? { tools: { patchPlan: patchPlanJsonSchema } } : {}),
  }
}
