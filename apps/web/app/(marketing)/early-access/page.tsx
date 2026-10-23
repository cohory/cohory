import { getPlatformConfig } from "@cohory/config/platform";
import {
  earlyAccessMemberCounts,
  earlyAccessNoteMax,
  earlyAccessPlatforms,
} from "@cohory/notifications/early-access";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MoreLink } from "../../../components/marketing/marketing-blocks";
import { getEarlyAccessService } from "../../../lib/early-access/service";
import { hasMarketingPages } from "../../../lib/marketing/edition";
import { marketingMetadata } from "../../../lib/marketing/metadata";
import { currentSession } from "../../../lib/session";
import { EarlyAccessForm } from "./early-access-form";

export function generateMetadata(): Metadata {
  return marketingMetadata({
    title: "Request early access",
    description: "Cloud is open to a small group of creators while we test it with them.",
    path: "/early-access",
  });
}

export default async function EarlyAccessPage() {
  const { edition, instance } = getPlatformConfig();
  if (!hasMarketingPages(edition)) {
    notFound();
  }
  const service = getEarlyAccessService();
  const session = await currentSession();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl text-text sm:text-4xl">Request early access</h1>
        <p className="text-lg font-normal text-text-muted">
          {instance.name} Cloud is open to a small group of creators while we test it with them.
          {service.available ? " Tell us about your community and we will email you." : null}
        </p>
      </header>
      {service.available ? (
        <EarlyAccessForm
          token={service.issueFormToken()}
          email={session?.user.email ?? ""}
          platforms={earlyAccessPlatforms}
          memberCounts={earlyAccessMemberCounts}
          noteMax={earlyAccessNoteMax}
        />
      ) : (
        <p className="text-base text-text">We are not taking new requests right now.</p>
      )}
      <div className="flex flex-col gap-1 border-t border-border pt-6">
        <p className="text-base text-text-muted">
          Want to start now? Run the Community Edition on your own server.
        </p>
        <MoreLink href="/open-source">Self-host now</MoreLink>
      </div>
    </div>
  );
}
