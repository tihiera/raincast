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

export function getGeminiApiKey(): string | null {
  return getKeys().google || null;
}

export function setGeminiApiKey(key: string): void {
  const keys = getKeys();
  keys.google = key;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function getAnthropicApiKey(): string | null {
  return getKeys().anthropic || null;
}

export function setAnthropicApiKey(key: string): void {
  const keys = getKeys();
  keys.anthropic = key;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function getActiveProviderId(): AiProviderId {
  const stored = localStorage.getItem(PROVIDER_KEY);
  if (stored === "gemini" || stored === "anthropic") return stored;
  return "gemini"; // default
}

export function setActiveProviderId(id: AiProviderId): void {
  localStorage.setItem(PROVIDER_KEY, id);
  // Also persist to DB (fire-and-forget)
  import("../tauri/db").then(({ dbSetSetting }) => {
    dbSetSetting("active_provider", id).catch(() => {});
  });
}
