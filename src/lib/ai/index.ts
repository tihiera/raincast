export * from "./types";
export * from "./registry";
export * from "./settings";

// Register providers on import
import { geminiProvider } from "./providers/gemini";
import { anthropicProvider } from "./providers/anthropic";
import { openaiCompatibleProvider } from "./providers/openai-compatible";
import { anthropicCompatibleProvider } from "./providers/anthropic-compatible";
import { registerProvider } from "./registry";

registerProvider(geminiProvider);
registerProvider(anthropicProvider);
registerProvider(openaiCompatibleProvider);
registerProvider(anthropicCompatibleProvider);
