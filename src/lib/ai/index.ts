export * from "./types";
export * from "./registry";
export * from "./settings";

// Register providers on import
import { geminiProvider } from "./providers/gemini";
import { anthropicProvider } from "./providers/anthropic";
import { registerProvider } from "./registry";

registerProvider(geminiProvider);
registerProvider(anthropicProvider);
