import Anthropic from "@anthropic-ai/sdk";
import type { ModelAdapter } from "../baseProvider";
import { createProvider } from "../baseProvider";
import { getAnthropicApiKey } from "../settings";

const MODEL_PRO = "claude-sonnet-4-6";
const MODEL_FAST = "claude-haiku-4-5-20251001";

function buildClient(): Anthropic {
  const key = getAnthropicApiKey();
  if (!key) throw new Error("No Anthropic API key configured. Add it in Settings (key icon in the top bar).");
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

function pickModel(tier?: "fast" | "pro"): string {
  return tier === "fast" ? MODEL_FAST : MODEL_PRO;
}

/** Build multimodal content array when images are present, or plain string when not. */
function buildUserContent(user: string, images?: Array<{ mime: string; base64: string }>): Anthropic.MessageCreateParams["messages"][0]["content"] {
  if (!images || images.length === 0) return user;

  const blocks: Anthropic.ContentBlockParam[] = [];

  // Images first so the model sees them before the text
  for (const img of images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: img.base64,
      },
    });
  }

  blocks.push({ type: "text", text: user });
  return blocks;
}

const adapter: ModelAdapter = {
  async generate(system, user, opts) {
    const client = buildClient();
    const maxTokens = opts?.model === "pro" ? 65536 : 16384;

    // Always use streaming internally to avoid the 10-minute timeout on long generations
    const stream = client.messages.stream({
      model: pickModel(opts?.model),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: buildUserContent(user, opts?.images) }],
    });

    let result = "";
    stream.on("text", (text) => { result += text; });
    await stream.finalMessage();
    return result;
  },

  async generateStream(system, user, onChunk, opts) {
    const client = buildClient();
    const maxTokens = opts?.model === "pro" ? 65536 : 16384;
    const stream = client.messages.stream({
      model: pickModel(opts?.model),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: buildUserContent(user, opts?.images) }],
    });

    stream.on("text", (text) => onChunk(text));
    await stream.finalMessage();
  },
};

export const anthropicProvider = createProvider("anthropic", "Anthropic", true, adapter);
