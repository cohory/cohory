import { getPlatformConfig } from "@cohory/config/platform";
import { parsePaymentsEnv } from "@cohory/payments";
import { formatFeeRate } from "@cohory/ui";

import { Fact, LegalDocument, Section } from "./legal-document";

const linkClass = "text-link";

export function CloudCreatorTerms() {
  const { instance } = getPlatformConfig();
  const { platformFeeBps } = parsePaymentsEnv();
  return (
    <LegalDocument title="Creator Terms">
      <p>
        These terms apply when you connect a payment account to a community on {instance.name}. They
        add to the Terms of Service.
      </p>
      <Section title="You are the seller">
        <p>
          Members buy memberships from you. You are the merchant of record and are responsible for
          what you sell, for taxes on your sales, and for your refund rule, which members see before
          they pay.
        </p>
      </Section>
      <Section title="Platform fee">
        <p>
          We charge a platform fee of {formatFeeRate(platformFeeBps)} of each payment, taken by
          Stripe when the payment is made. Stripe&apos;s own fees are separate. We tell you at least
          60 days before the fee changes.
        </p>
      </Section>
      <Section title="Refunds and chargebacks">
        <p>
          You handle refunds in your Stripe account. When a member disputes a payment, Stripe
          handles the dispute with you; if you lose it, we refund our fee on that payment.
        </p>
      </Section>
      <Section title="Payment processing">
        <p>
          Payment processing is provided by Stripe under the{" "}
          <a className={linkClass} href="https://stripe.com/legal/connect-account">
            Stripe Connected Account Agreement
          </a>
          , which includes the{" "}
          <a className={linkClass} href="https://stripe.com/legal/ssa">
            Stripe Services Agreement
          </a>
          . By connecting, you agree to it.
        </p>
      </Section>
      <Section title="Leaving">
        <p>
          You can disconnect at any time. Your members&apos; subscriptions stay in your Stripe
          account, and our fee is removed from future invoices.
        </p>
      </Section>
      <Section title="Member data">
        <p>
          You are the controller of your members&apos; data and we process it for you under the Data
          Processing Agreement, which is part of these terms.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Write to <Fact fact="contactEmail" />. These terms are governed by{" "}
          <Fact fact="governingLaw" />.
        </p>
      </Section>
    </LegalDocument>
  );
}
