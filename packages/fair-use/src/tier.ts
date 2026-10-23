import type { FairUseConfig, FairUseLimits, FairUseTier } from "./config";
import { limitsFor } from "./config";

export const paidTierWindowDays = 90;

const dayMs = 24 * 60 * 60 * 1000;

export function paidTierWindowStart(now: Date): Date {
  return new Date(now.getTime() - paidTierWindowDays * dayMs);
}

export function tierFromPaidActivity(hasPaidTransaction: boolean): FairUseTier {
  return hasPaidTransaction ? "paid" : "free";
}

export async function resolveLimits(
  config: FairUseConfig,
  resources: readonly (keyof FairUseLimits)[],
  tierOf: () => Promise<FairUseTier>,
): Promise<FairUseLimits> {
  if (resources.every((resource) => config.free[resource] === config.paid[resource])) {
    return config.free;
  }
  return limitsFor(config, await tierOf());
}
