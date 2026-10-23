import type { MemberBilling } from "@cohory/payments";
import { formatMoney } from "@cohory/ui";

type PayingBilling = Extract<MemberBilling, { paying: true }>;

function payment(name: string, billing: PayingBilling): string {
  if (billing.amountMinor === null || billing.currency === null || billing.interval === null) {
    return `${name} pays for a subscription`;
  }
  return `${name} pays ${formatMoney(billing.amountMinor, billing.currency)} per ${billing.interval}`;
}

export function removalDescription(name: string, billing: MemberBilling, text: string): string {
  if (!billing.paying) {
    return text;
  }
  if (billing.amountMinor === null || billing.currency === null || billing.interval === null) {
    return `${name} pays for a subscription. It ends now with no refund. ${text}`;
  }
  return `${payment(name, billing)}. Their subscription ends now with no refund. ${text}`;
}

export interface SelectedBilling {
  readonly name: string;
  readonly billing: MemberBilling;
}

const listedPayers = 5;

export function bulkRemovalDescription(people: readonly SelectedBilling[], text: string): string {
  const payers = people.flatMap(({ name, billing }) =>
    billing.paying ? [payment(name, billing)] : [],
  );
  if (payers.length === 0) {
    return text;
  }
  const rest = payers.length - listedPayers;
  const listed = payers.slice(0, listedPayers).join(", ");
  const list = rest > 0 ? `${listed}, and ${rest} more` : listed;
  return `${payers.length} of the ${people.length} people pay: ${list}. Their subscriptions end now with no refund. ${text}`;
}
