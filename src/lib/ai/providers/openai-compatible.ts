import type { ModelAdapter } from "../baseProvider";
import { createProvider } from "../baseProvider";
import {
  getOpenAICompatibleApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAICompatibleModel,
} from "../settings";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL_PRO = "gpt-4o";
const DEFAULT_MODEL_FAST = "gpt-4o-mini";

function buildClient() {
  const key = getOpenAICompatibleApiKey();
  if (!key) throw new Error("No OpenAI Compatible API key configured. Add it in Settings (key icon in the top bar).");
  const baseUrl = getOpenAICompatibleBaseUrl() || DEFAULT_BASE_URL;
  return { key, baseUrl };
}

function getModel(tier?: "fast" | "pro"): string {
  const saved = getOpenAICompatibleModel();
  if (saved) return saved;
  return tier === "fast" ? DEFAULT_MODEL_FAST : DEFAULT_MODEL_PRO;
}

const adapter: ModelAdapter = {
  async generate(system, user, opts) {
    const { key, baseUrl } = buildClient();
    const model = getModel(opts?.model);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Compatible API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  },

  async generateStream(system, user, onChunk, opts) {
    const { key, baseUrl } = buildClient();
    const model = getModel(opts?.model);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Compatible API error ${response.status}: ${err}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    const wrapper = {
      onChunk: (text: string) => {},
      push(chunk: string) { this.onChunk(chunk); },
    };
    wrapper.onChunk = onChunk;

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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) wrapper.push(content);
          } catch { /* skip malformed lines */ }
        }
      }
    }
  },
};

export const openaiCompatibleProvider = createProvider(
  "openai",
  "OpenAI Compatible",
  false,
  adapter,
);