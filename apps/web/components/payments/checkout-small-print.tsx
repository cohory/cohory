export interface CheckoutTerms {
  readonly seller: string | null;
  readonly refundPolicy: string | null;
  readonly termsHref: string;
  readonly privacyHref: string;
}

const smallLinkClass = "underline underline-offset-4 hover:text-text";

export function SmallPrint({
  providerName,
  checkout,
}: {
  providerName: string;
  checkout: CheckoutTerms;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span>
        {checkout.seller ? `Sold by ${checkout.seller}. ` : null}
        {checkout.refundPolicy ?? "Ask the creator for refunds."}
      </span>
      <span>
        Payments are processed by {providerName}. Taxes may apply. You can cancel any time and keep
        access until the end of the period you paid for.
      </span>
      <span className="flex gap-3">
        <a href={checkout.termsHref} className={smallLinkClass}>
          Terms
        </a>
        <a href={checkout.privacyHref} className={smallLinkClass}>
          Privacy
        </a>
      </span>
    </span>
  );
}
