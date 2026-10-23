import type { FairUseLimits, FairUseTier } from "./config";

export type UsageState = "ok" | "near" | "reached";

export interface UsageItem {
  readonly used: number;
  readonly limit: number | null;
  readonly state: UsageState;
}

export interface CommunityUsage {
  readonly tier: FairUseTier;
  readonly members: UsageItem;
  readonly storageBytes: UsageItem;
  readonly uploadBytes: number | null;
}

export interface UsageCounts {
  readonly members: number;
  readonly storageBytes: number;
}

export const nearLimitRatio = 0.8;

export function usageItem(used: number, limit: number | null): UsageItem {
  if (limit === null) {
    return { used, limit, state: "ok" };
  }
  if (used >= limit) {
    return { used, limit, state: "reached" };
  }
  return { used, limit, state: used >= limit * nearLimitRatio ? "near" : "ok" };
}

export function summarizeUsage(
  tier: FairUseTier,
  limits: FairUseLimits,
  counts: UsageCounts,
): CommunityUsage {
  return {
    tier,
    members: usageItem(counts.members, limits.members),
    storageBytes: usageItem(counts.storageBytes, limits.storageBytes),
    uploadBytes: limits.uploadBytes,
  };
}
