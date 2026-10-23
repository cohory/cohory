import { PaymentsUnavailableError } from "../errors";
import type { PaymentProvider, ProviderId } from "./types";

export interface ProviderRegistry {
  get(id: ProviderId): PaymentProvider;
  find(id: ProviderId): PaymentProvider | null;
  ids(): readonly ProviderId[];
}

export class DuplicateProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`payment provider ${providerId} is registered twice`);
    this.name = "DuplicateProviderError";
  }
}

export function createProviderRegistry(providers: readonly PaymentProvider[]): ProviderRegistry {
  const byId = new Map<ProviderId, PaymentProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      throw new DuplicateProviderError(provider.id);
    }
    byId.set(provider.id, provider);
  }
  return {
    get(id) {
      const provider = byId.get(id);
      if (!provider) {
        throw new PaymentsUnavailableError(`${id} provider`);
      }
      return provider;
    },
    find(id) {
      return byId.get(id) ?? null;
    },
    ids() {
      return [...byId.keys()];
    },
  };
}
