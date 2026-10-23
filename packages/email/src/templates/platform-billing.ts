import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

type PlatformInvoiceEmailInput = {
  communityName: string;
  periodLabel: string;
  amountMinor: number;
  currency: string;
  url: string;
  billingUrl: string;
  communityBrand?: CommunityBrandInput;
};

export function formatMinorAmount(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits =
    new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
    amountMinor / 10 ** digits,
  );
}

function footer(communityName: string) {
  const instance = instanceName();
  return {
    why: `You received this email because you own ${communityName} on ${instance} and it sells memberships through a payment provider that ${instance} bills monthly.`,
  };
}

export function platformInvoicePaymentFailedEmail(input: PlatformInvoiceEmailInput): EmailContent {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return buildEmail({
    template: "platform-invoice-payment-failed",
    subject: "Payment failed for your platform fee invoice",
    preheader: `Pay ${amount} or update your card to keep paid signups open.`,
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      `We couldn't collect ${amount} for your ${instanceName()} platform fee invoice for ${input.periodLabel}.`,
      "Open the invoice to pay it, or update the card on the Platform fees page.",
    ],
    cta: { label: "Pay the invoice", url: input.url },
    after: [
      { kind: "link", label: "Open Platform fees", url: input.billingUrl },
      `If the invoice is still unpaid 30 days after the failed payment, new paid signups to ${input.communityName} pause until it is paid. Existing members keep their access.`,
    ],
    footer: footer(input.communityName),
  });
}

export function platformBillingPausedEmail(input: PlatformInvoiceEmailInput): EmailContent {
  const amount = formatMinorAmount(input.amountMinor, input.currency);
  return buildEmail({
    template: "platform-billing-paused",
    subject: "New paid signups are paused",
    preheader: "Pay the invoice and signups open again within a day.",
    brand: communityBrand(input.communityName, input.communityBrand),
    body: [
      `New paid signups to ${input.communityName} are paused because the platform fee invoice for ${input.periodLabel} (${amount}) has been unpaid for 30 days.`,
      "Existing members keep their access. Pay the invoice and signups open again within a day.",
    ],
    cta: { label: "Pay the invoice", url: input.url },
    after: [{ kind: "link", label: "Open Platform fees", url: input.billingUrl }],
    footer: footer(input.communityName),
  });
}
