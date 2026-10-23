import {
  formatBytes,
  formatMembers,
  paidTierWindowDays,
  parseFairUseEnv,
  type FairUseConfig,
} from "@cohory/fair-use";
import { parsePaymentsEnv } from "@cohory/payments";
import { formatFeeRate, platformFeeLine } from "@cohory/ui";

type Env = Readonly<Record<string, string | undefined>>;

export interface LimitRow {
  readonly label: string;
  readonly free: string;
  readonly paid: string;
}

export interface CloudPricing {
  readonly feeRate: string | null;
  readonly feeLine: string;
  readonly summary: string;
  readonly selfHostedFeeLine: string;
  readonly limits: readonly LimitRow[];
  readonly paidWindowDays: number;
}

const processing = "Stripe processing fees are separate.";

function limitText(value: number | null, format: (value: number) => string): string {
  return value === null ? "No limit" : format(value);
}

export function cloudPricing({
  platformFeeBps,
  fairUse,
}: {
  platformFeeBps: number;
  fairUse: FairUseConfig;
}): CloudPricing {
  const feeRate = platformFeeBps > 0 ? formatFeeRate(platformFeeBps) : null;
  const { free, paid } = fairUse;
  return {
    feeRate,
    feeLine: platformFeeLine("cloud", platformFeeBps),
    summary: feeRate
      ? `Free to start. ${feeRate} of each payment you receive. ${processing}`
      : `Free to start. No platform fee. ${processing}`,
    selfHostedFeeLine: platformFeeLine("community", 0),
    limits: [
      {
        label: "Members",
        free: limitText(free.members, formatMembers),
        paid: limitText(paid.members, formatMembers),
      },
      {
        label: "File storage",
        free: limitText(free.storageBytes, formatBytes),
        paid: limitText(paid.storageBytes, formatBytes),
      },
      {
        label: "Largest upload",
        free: limitText(free.uploadBytes, formatBytes),
        paid: limitText(paid.uploadBytes, formatBytes),
      },
    ],
    paidWindowDays: paidTierWindowDays,
  };
}

export function loadCloudPricing(env: Env = process.env): CloudPricing {
  return cloudPricing({
    platformFeeBps: parsePaymentsEnv(env).platformFeeBps,
    fairUse: parseFairUseEnv(env),
  });
}
