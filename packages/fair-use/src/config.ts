import { parseEdition, type Edition } from "@cohory/config/platform";
import { z } from "zod";

export type FairUseTier = "free" | "paid";

export interface FairUseLimits {
  readonly members: number | null;
  readonly storageBytes: number | null;
  readonly uploadBytes: number | null;
}

export interface FairUseConfig {
  readonly edition: Edition;
  readonly free: FairUseLimits;
  readonly paid: FairUseLimits;
}

const gigabyte = 1024 ** 3;
const megabyte = 1024 ** 2;

export const unlimited: FairUseLimits = { members: null, storageBytes: null, uploadBytes: null };

export const cloudFairUseDefaults = {
  free: { members: 1000, storageBytes: 5 * gigabyte, uploadBytes: 500 * megabyte },
  paid: { members: null, storageBytes: 50 * gigabyte, uploadBytes: 2 * gigabyte },
} as const satisfies Record<FairUseTier, FairUseLimits>;

export const fairUseEnvNames = {
  free: {
    members: "FAIR_USE_MEMBERS",
    storageBytes: "FAIR_USE_STORAGE_BYTES",
    uploadBytes: "FAIR_USE_UPLOAD_BYTES",
  },
  paid: {
    members: "FAIR_USE_PAID_MEMBERS",
    storageBytes: "FAIR_USE_PAID_STORAGE_BYTES",
    uploadBytes: "FAIR_USE_PAID_UPLOAD_BYTES",
  },
} as const satisfies Record<FairUseTier, Record<keyof FairUseLimits, string>>;

const limitSchema = z
  .string()
  .trim()
  .regex(/^(unlimited|[1-9]\d*)$/, "Use a whole number above 0 or the word unlimited.")
  .transform((value) => (value === "unlimited" ? null : Number(value)))
  .refine((value) => value === null || Number.isSafeInteger(value), "The number is too large.");

type Env = Readonly<Record<string, string | undefined>>;

function override(env: Env, name: string, fallback: number | null): number | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = limitSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
  }
  return parsed.data;
}

function tierLimits(env: Env, tier: FairUseTier, base: FairUseLimits): FairUseLimits {
  const names = fairUseEnvNames[tier];
  return {
    members: override(env, names.members, base.members),
    storageBytes: override(env, names.storageBytes, base.storageBytes),
    uploadBytes: override(env, names.uploadBytes, base.uploadBytes),
  };
}

export function parseFairUseEnv(env: Env = process.env): FairUseConfig {
  const edition = parseEdition(env);
  if (edition === "cloud") {
    return {
      edition,
      free: tierLimits(env, "free", cloudFairUseDefaults.free),
      paid: tierLimits(env, "paid", cloudFairUseDefaults.paid),
    };
  }
  const free = tierLimits(env, "free", unlimited);
  return { edition, free, paid: tierLimits(env, "paid", free) };
}

export function limitsFor(config: FairUseConfig, tier: FairUseTier): FairUseLimits {
  return tier === "paid" ? config.paid : config.free;
}

export function hasUploadLimits(config: FairUseConfig): boolean {
  return [config.free, config.paid].some(
    (limits) => limits.storageBytes !== null || limits.uploadBytes !== null,
  );
}

let cached: FairUseConfig | undefined;

export function getFairUseConfig(): FairUseConfig {
  cached ??= parseFairUseEnv();
  return cached;
}
