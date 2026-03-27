// Prompts barrel – provider-agnostic prompt/schema builders

export { patchPlanJsonSchema, patchBlocksFormatDescription } from "./prompts/toolSchemas.js"
export { RAIN_GEN_SYSTEM_PROMPT, RAIN_UI_FROM_IMAGE_SYSTEM_PROMPT } from "./prompts/systemPrompts.js"
export { buildTextOnlyRequest, buildUiFromImageRequest } from "./prompts/buildRequests.js"
export type { OutputFormat, ImagePayload, TextOnlyRequestOpts, UiFromImageRequestOpts, LlmRequest } from "./prompts/buildRequests.js"
