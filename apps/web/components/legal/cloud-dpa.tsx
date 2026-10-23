import { getPlatformConfig } from "@cohory/config/platform";

import { Fact, LegalDocument, Section } from "./legal-document";

export function CloudDpa() {
  const { instance } = getPlatformConfig();
  return (
    <LegalDocument title="Data Processing Agreement">
      <p>
        This agreement is between you, the creator, as controller, and <Fact fact="entity" />, as
        processor, for the member data of your communities on {instance.name} (GDPR Article 28).
      </p>
      <Section title="What we process">
        <p>
          Members&apos; names, email addresses, profile details, posts, comments, course progress,
          event RSVPs, and membership and payment status, only to run your community.
        </p>
      </Section>
      <Section title="How we process it">
        <ul className="list-disc pl-6">
          <li>Only on your instructions, which are the settings you choose in the product.</li>
          <li>People with access are bound to confidentiality.</li>
          <li>Data is encrypted in transit, and every query is limited to one community.</li>
          <li>We help you answer member requests to see, export, or delete their data.</li>
          <li>We tell you without undue delay about a personal data breach.</li>
          <li>When you delete a community, we delete its data, except records the law requires.</li>
        </ul>
      </Section>
      <Section title="Subprocessors">
        <p>
          Data is stored in <Fact fact="dataRegion" />. We use services for hosting, file storage,
          email delivery, and payments (Stripe). We tell you before we add or replace one.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Write to <Fact fact="contactEmail" />.
        </p>
      </Section>
    </LegalDocument>
  );
}
