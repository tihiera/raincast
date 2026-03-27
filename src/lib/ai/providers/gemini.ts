import { GoogleGenAI } from "@google/genai";
import type { ModelAdapter } from "../baseProvider";
import { createProvider } from "../baseProvider";
import { getGeminiApiKey } from "../settings";
import type { Content, Part } from "@google/genai";

const MODEL_PRO = "gemini-3.1-pro-preview";
const MODEL_FLASH = "gemini-3-flash-preview";
const MODEL_IMAGE = "gemini-3.1-flash-image-preview";

function buildClient(): GoogleGenAI {
  const key = getGeminiApiKey();
  if (!key) throw new Error("No Gemini API key configured. Add it in Settings (key icon in the top bar).");
  return new GoogleGenAI({ apiKey: key });
}

function pickModel(tier?: "fast" | "pro"): string {
  return tier === "fast" ? MODEL_FLASH : MODEL_PRO;
}

/** Build multimodal contents when images are present. */
function buildContents(user: string, images?: Array<{ mime: string; base64: string }>): string | Content[] {
  if (!images || images.length === 0) return user;

  const parts: Part[] = [];

  // Images first
  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mime,
        data: img.base64,
      },
    });
  }

  parts.push({ text: user });

  return [{ role: "user", parts }];
}

const adapter: ModelAdapter = {
  async generate(system, user, opts) {
    const client = buildClient();
    const maxOutputTokens = opts?.model === "pro" ? 65536 : 16384;
    const response = await client.models.generateContent({
      model: pickModel(opts?.model),
      contents: buildContents(user, opts?.images),
      config: {
        systemInstruction: system,
        maxOutputTokens,
        ...(opts?.json ? { responseMimeType: "application/json" } : {}),
      },
    });
    return response.text ?? "";
  },

  async generateImage(prompt) {
    const client = buildClient();
    const response = await client.models.generateContent({
      model: MODEL_IMAGE,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { base64: part.inlineData.data, mime: part.inlineData.mimeType || "image/png" };
      }
    }
    return null;
  },

  async generateStream(system, user, onChunk, opts) {
    const client = buildClient();
    const stream = await client.models.generateContentStream({
      model: pickModel(opts?.model),
      contents: buildContents(user, opts?.images),
      config: {
        systemInstruction: system,
      },
    });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) onChunk(text);
    }
  },
};

export const geminiProvider = createProvider("gemini", "Gemini", true, adapter);
