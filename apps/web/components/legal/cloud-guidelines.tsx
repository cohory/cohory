import { getPlatformConfig } from "@cohory/config/platform";

import { LegalDocument, Section } from "./legal-document";

export function CloudGuidelines() {
  const { instance } = getPlatformConfig();
  return (
    <LegalDocument title="Community Guidelines">
      <p>
        These rules apply to every community on {instance.name}. Creators can add their own rules
        for their community, but not loosen these.
      </p>
      <Section title="Content that is not allowed">
        <ul className="list-disc pl-6">
          <li>Anything illegal where you or your members live.</li>
          <li>Sexual content involving minors, in any form.</li>
          <li>Threats, harassment, or attacks on people for who they are.</li>
          <li>Content that encourages self harm or violence.</li>
          <li>Other people&apos;s private information shared without their consent.</li>
          <li>Material that infringes copyright or trademarks.</li>
          <li>Malware, phishing, and spam.</li>
        </ul>
      </Section>
      <Section title="What you may not sell">
        <p>
          Paid communities must follow Stripe&apos;s list of restricted businesses. That includes,
          among others, gambling, adult content, weapons, drugs, financial schemes that promise
          returns, and counterfeit goods.
        </p>
        <a className="text-link" href="https://stripe.com/legal/restricted-businesses">
          Stripe restricted businesses
        </a>
      </Section>
      <Section title="What happens when rules are broken">
        <p>
          We may remove content, pause payments, or close a community or account. We tell the people
          affected why and how to ask us to look again.
        </p>
      </Section>
    </LegalDocument>
  );
}
