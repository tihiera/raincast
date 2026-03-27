import type { AiProvider, AiProviderId } from "./types";

const providers = new Map<AiProviderId, AiProvider>();

export function registerProvider(provider: AiProvider) {
  providers.set(provider.id, provider);
}

export function getProviders(): AiProvider[] {
  return [...providers.values()];
}

export function getProviderById(id: AiProviderId): AiProvider | undefined {
  return providers.get(id);
}
