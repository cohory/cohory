import { getLegalConfig, legalLinks, minimumAge } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import Link from "next/link";

import { Fact, LegalDocument, Section } from "./legal-document";

const linkClass = "text-link";

export function CloudTerms() {
  const { instance } = getPlatformConfig();
  const links = legalLinks(getLegalConfig(), "cloud");
  return (
    <LegalDocument title="Terms of Service">
      <Section title="Who we are">
        <p>
          {instance.name} is run by <Fact fact="entity" />. These terms are the agreement between
          you and us when you create an account or use any community hosted here.
        </p>
      </Section>
      <Section title="Your account">
        <p>
          You must be {minimumAge} or older to create an account. Keep your password safe and tell
          us if you think someone else used your account. You can delete your account at any time
          from your account page.
        </p>
      </Section>
      <Section title="Communities and creators">
        <p>
          Each community is run by its creator. Creators decide who may join, what members see, and
          the rules inside their community. When you buy a membership, you buy it from the creator,
          not from us. The creator&apos;s refund rule is shown before you pay.
        </p>
        <p>
          Creators who take payments also agree to the{" "}
          {links.creatorTerms ? (
            <Link className={linkClass} href={links.creatorTerms}>
              Creator Terms
            </Link>
          ) : (
            "Creator Terms"
          )}
          .
        </p>
      </Section>
      <Section title="What you may not do">
        <p>
          Follow the{" "}
          {links.guidelines ? (
            <Link className={linkClass} href={links.guidelines}>
              Community Guidelines
            </Link>
          ) : (
            "Community Guidelines"
          )}
          . Do not post illegal content, break other people&apos;s rights, send spam, or try to get
          around access controls or another community&apos;s privacy.
        </p>
      </Section>
      <Section title="Moderation and reports">
        <p>
          Creators and their moderators handle reports inside their community. Anyone can also
          report illegal content to us
          {links.report ? (
            <>
              {" "}
              through the{" "}
              <Link className={linkClass} href={links.report}>
                report form
              </Link>
            </>
          ) : null}
          . When we remove content or limit an account, we tell the people affected why and how to
          ask us to look again.
        </p>
      </Section>
      <Section title="Your content">
        <p>
          You keep the rights to what you post. You let us store and show it to the people your
          community settings allow, only to run the service.
        </p>
      </Section>
      <Section title="Ending the agreement">
        <p>
          You can stop using the service and delete your account at any time. We may suspend or
          close an account that breaks these terms, and we tell you why unless the law forbids it.
        </p>
      </Section>
      <Section title="Liability">
        <p>
          We provide the service as it is. Nothing in these terms limits rights you have under
          consumer law that cannot be limited.
        </p>
      </Section>
      <Section title="Changes and governing law">
        <p>
          We tell you before changes to these terms take effect. These terms are governed by{" "}
          <Fact fact="governingLaw" />.
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
