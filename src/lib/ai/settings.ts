import type { AiProviderId } from "./types";

const STORAGE_KEY = "raincast-api-keys";
const PROVIDER_KEY = "raincast-active-provider";

function getKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setKeys(keys: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    console.warn("[settings] Failed to save API keys to localStorage");
  }
}

export function getGeminiApiKey(): string | null {
  return getKeys().google || null;
}

export function setGeminiApiKey(key: string): void {
  const keys = getKeys();
  keys.google = key;
  setKeys(keys);
}

export function getAnthropicApiKey(): string | null {
  return getKeys().anthropic || null;
}

export function setAnthropicApiKey(key: string): void {
  const keys = getKeys();
  keys.anthropic = key;
  setKeys(keys);
}

export function getBraveApiKey(): string | null {
  return getKeys().brave || null;
}

export function setBraveApiKey(key: string): void {
  const keys = getKeys();
  keys.brave = key;
  setKeys(keys);
}

// ── OpenAI Compatible ──────────────────────────────────────────────────────────

export function getOpenAICompatibleApiKey(): string | null {
  return getKeys()["openai-compatible-key"] || null;
}

export function setOpenAICompatibleApiKey(key: string): void {
  const keys = getKeys();
  keys["openai-compatible-key"] = key;
  setKeys(keys);
}

export function getOpenAICompatibleBaseUrl(): string | null {
  return getKeys()["openai-compatible-url"] || null;
}

export function setOpenAICompatibleBaseUrl(url: string): void {
  const keys = getKeys();
  keys["openai-compatible-url"] = url;
  setKeys(keys);
}

export function getOpenAICompatibleModel(): string | null {
  return getKeys()["openai-compatible-model"] || null;
}

export function setOpenAICompatibleModel(model: string): void {
  const keys = getKeys();
  keys["openai-compatible-model"] = model;
  setKeys(keys);
}

// ── Anthropic Compatible ───────────────────────────────────────────────────────

export function getAnthropicCompatibleApiKey(): string | null {
  return getKeys()["anthropic-compatible-key"] || null;
}

export function setAnthropicCompatibleApiKey(key: string): void {
  const keys = getKeys();
  keys["anthropic-compatible-key"] = key;
  setKeys(keys);
}

export function getAnthropicCompatibleBaseUrl(): string | null {
  return getKeys()["anthropic-compatible-url"] || null;
}

export function setAnthropicCompatibleBaseUrl(url: string): void {
  const keys = getKeys();
  keys["anthropic-compatible-url"] = url;
  setKeys(keys);
}

export function getAnthropicCompatibleModel(): string | null {
  return getKeys()["anthropic-compatible-model"] || null;
}

export function setAnthropicCompatibleModel(model: string): void {
  const keys = getKeys();
  keys["anthropic-compatible-model"] = model;
  setKeys(keys);
}

export function getActiveProviderId(): AiProviderId {
  try {
    const stored = localStorage.getItem(PROVIDER_KEY);
    if (stored === "gemini" || stored === "anthropic" || stored === "openai" || stored === "anthropic-compatible") return stored;
  } catch { /* localStorage unavailable */ }
  return "gemini"; // default
}

export function setActiveProviderId(id: AiProviderId): void {
  try {
    localStorage.setItem(PROVIDER_KEY, id);
  } catch {
    console.warn("[settings] Failed to save active provider to localStorage");
  }
  // Also persist to DB (fire-and-forget)
  import("../tauri/db").then(({ dbSetSetting }) => {
    dbSetSetting("active_provider", id).catch((err) => {
      console.error("[settings] Failed to persist provider to DB:", err);
    });
  });
}
