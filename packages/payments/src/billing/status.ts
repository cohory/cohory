import type { PlatformInvoiceStatus } from "@cohory/db/schema";

const known: readonly PlatformInvoiceStatus[] = ["draft", "open", "paid", "void", "uncollectible"];

export function invoiceStatusOf(stripeStatus: string | null): PlatformInvoiceStatus {
  const match = known.find((status) => status === stripeStatus);
  return match ?? "draft";
}

export const pastDueSuspensionDays = 30;

export function suspensionDue(pastDueSince: Date | null, now: Date): boolean {
  if (!pastDueSince) {
    return false;
  }
  return now.getTime() - pastDueSince.getTime() >= pastDueSuspensionDays * 86_400_000;
}

export type InvoiceDisplayStatus = PlatformInvoiceStatus | "past_due";

export function displayStatus(
  status: PlatformInvoiceStatus,
  pastDueSince: Date | null,
): InvoiceDisplayStatus {
  return status === "open" && pastDueSince ? "past_due" : status;
}
