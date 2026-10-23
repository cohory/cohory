import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { Button } from "@cohory/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarketingSection } from "../../../components/marketing/marketing-blocks";
import { currentCreatorCta, SignUpCta } from "../../../components/marketing/marketing-shell";
import { hasMarketingPages } from "../../../lib/marketing/edition";
import { marketingMetadata } from "../../../lib/marketing/metadata";
import { loadCloudPricing } from "../../../lib/marketing/pricing";

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Open source",
    description:
      "Cohory is open source. Run the Community Edition on your own server, with no platform fee.",
    path: "/open-source",
  });
}

const docClass = "rounded-sm bg-surface-raised px-1 font-mono text-sm text-text";

export default function OpenSourcePage() {
  const { edition } = getPlatformConfig();
  if (!hasMarketingPages(edition)) {
    notFound();
  }
  const { sourceUrl } = getLegalConfig();
  const { selfHostedFeeLine } = loadCloudPricing();
  const cta = currentCreatorCta();

  return (
    <div className="flex flex-col">
      <header className="flex max-w-2xl flex-col gap-3 pb-10">
        <h1 className="text-3xl text-text sm:text-4xl">Open source</h1>
        <p className="text-lg font-normal text-text-muted">
          Cohory is open source. We run it for you here, or you run the Community Edition on your
          own server.
        </p>
        {sourceUrl ? (
          <div className="pt-2">
            <Button asChild size="lg" variant="secondary">
              <a href={sourceUrl}>Get the source code</a>
            </Button>
          </div>
        ) : null}
      </header>

      <MarketingSection
        id="community-edition"
        title="The Community Edition"
        lead="The same software with the same features, on a server you control."
      >
        <ul className="flex max-w-2xl list-disc flex-col gap-2 pl-5 text-base text-text-muted">
          <li>Members pay you through your own Stripe keys. {selfHostedFeeLine}</li>
          <li>You choose the limits, the name, and the logo of your server.</li>
          <li>It runs with Docker Compose and PostgreSQL. No outside service is needed.</li>
        </ul>
      </MarketingSection>

      <MarketingSection id="license" title="License">
        <div className="flex max-w-2xl flex-col gap-3 text-base text-text-muted">
          <p>
            The core is licensed under the GNU Affero General Public License, version 3. You can
            use, study, change, and run it. If you change it and let other people use it over a
            network, you offer them your changed source under the same license.
          </p>
          <p>
            The SDK, the generated API client, and the agent runner are MIT licensed, so code you
            build on them can use any license.
          </p>
        </div>
      </MarketingSection>

      <MarketingSection id="move" title="Move to your own server">
        <div className="flex max-w-2xl flex-col gap-3 text-base text-text-muted">
          <p>
            Export your community from Manage, Migration as an archive with members, posts, courses,
            events, points, and files. Import it into an empty community on your server.
            Subscriptions stay in your Stripe account, and your server can link them to your members
            by email.
          </p>
          <p>
            The self-hosting guide is <code className={docClass}>docs/self-hosting.md</code> in the
            source code, and moving from Cloud is described in{" "}
            <code className={docClass}>docs/operations/offboarding.md</code>.
          </p>
        </div>
      </MarketingSection>

      {cta === "self-host" ? null : (
        <section
          aria-labelledby="start"
          className="flex flex-col items-start gap-4 border-t border-border pt-12"
        >
          <h2 id="start" className="text-2xl text-text">
            {cta === "early-access"
              ? "Or ask for early access to Cloud"
              : "Or start on Cloud today"}
          </h2>
          <SignUpCta selfHost={false} />
        </section>
      )}
    </div>
  );
}
