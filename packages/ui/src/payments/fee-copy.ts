import type { Edition } from "@cohory/config/edition";

import { formatFeeRate } from "./money";

export type { Edition };

export interface FeeProvider {
  readonly name: string;
  readonly feeSplit: boolean;
}

const stripe: FeeProvider = { name: "Stripe", feeSplit: true };

export function platformFeeLine(
  edition: Edition,
  platformFeeBps: number,
  provider: FeeProvider = stripe,
): string {
  const processing = `${provider.name} processing fees are separate.`;
  if (edition !== "cloud" || platformFeeBps === 0) {
    return `No platform fee. ${processing}`;
  }
  if (!provider.feeSplit) {
    return `Platform fee: ${formatFeeRate(platformFeeBps)} of each successful payment, recorded here and billed to you monthly. ${processing}`;
  }
  return `Platform fee: ${formatFeeRate(platformFeeBps)} of each successful payment. ${processing}`;
}
