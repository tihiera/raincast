import type { ModelAdapter } from "../baseProvider";
import { createProvider } from "../baseProvider";
import {
  getAnthropicCompatibleApiKey,
  getAnthropicCompatibleBaseUrl,
  getAnthropicCompatibleModel,
} from "../settings";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL_PRO = "claude-sonnet-4-6";
const DEFAULT_MODEL_FAST = "claude-haiku-4-5-20251001";

function buildClient() {
  const key = getAnthropicCompatibleApiKey();
  if (!key) throw new Error("No Anthropic Compatible API key configured. Add it in Settings (key icon in the top bar).");
  const baseUrl = getAnthropicCompatibleBaseUrl() || DEFAULT_BASE_URL;
  return { key, baseUrl };
}

function getModel(tier?: "fast" | "pro"): string {
  const saved = getAnthropicCompatibleModel();
  if (saved) return saved;
  return tier === "fast" ? DEFAULT_MODEL_FAST : DEFAULT_MODEL_PRO;
}

const adapter: ModelAdapter = {
  async generate(system, user, opts) {
    const { key, baseUrl } = buildClient();
    const model = getModel(opts?.model);
    const maxTokens = opts?.model === "pro" ? 65536 : 4096;

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic Compatible API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text ?? "";
  },

  async generateStream(system, user, onChunk, opts) {
    const { key, baseUrl } = buildClient();
    const model = getModel(opts?.model);
    const maxTokens = opts?.model === "pro" ? 65536 : 4096;

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic Compatible API error ${response.status}: ${err}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json === "[DONE]") return;
          try {
            const parsed = JSON.parse(json);
            if (parsed.type === "content_block_delta") {
              onChunk(parsed.delta?.text ?? "");
            }
          } catch { /* skip malformed lines */ }
        }
      }
    }
  },
};

export const anthropicCompatibleProvider = createProvider(
  "anthropic-compatible",
  "Anthropic Compatible",
  false,
  adapter,
);