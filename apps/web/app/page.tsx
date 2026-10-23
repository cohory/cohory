import {
  canCreateCommunities,
  getPlatformConfig,
  type InstanceBranding,
} from "@cohory/config/platform";
import { Button } from "@cohory/ui";
import { Plus, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "../components/empty-state";
import { CloudLanding } from "../components/marketing/cloud-landing";
import { MarketingShell } from "../components/marketing/marketing-shell";
import { MyCommunityCard } from "../components/my-community-card";
import { withNext } from "../lib/auth/form-links";
import { homeDestination } from "../lib/communities/home-destination";
import { loadMyCommunities, type MyCommunity } from "../lib/communities/my-communities";
import { earlyAccessLinkFor } from "../lib/early-access/service";
import { hasMarketingPages } from "../lib/marketing/edition";
import { loadCloudPricing } from "../lib/marketing/pricing";
import { currentSession } from "../lib/session";
import PlatformLayout from "./(platform)/layout";

function SignedOutHome({
  instance,
  creatorSignUp,
}: {
  instance: InstanceBranding;
  creatorSignUp: boolean;
}) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-3xl font-semibold text-balance text-text sm:text-4xl">
        Welcome to {instance.name}
      </h1>
      <p className="text-base text-balance text-text-muted sm:text-lg">
        {creatorSignUp
          ? "Sign in to see your communities, or create your own."
          : "Sign in to see your communities."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button asChild size="lg">
          {creatorSignUp ? (
            <Link href={withNext("/sign-up", "/communities/new")}>Create your community</Link>
          ) : (
            <Link href="/sign-in">Sign in</Link>
          )}
        </Button>
      </div>
    </section>
  );
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const landingDescription =
  "Run your community, courses, events, and paid memberships in one place, on open source software you can take with you.";

export async function generateMetadata(): Promise<Metadata> {
  const { edition, instance } = getPlatformConfig();
  if (!hasMarketingPages(edition) || (await loadMyCommunities()) !== null) {
    return { alternates: { canonical: "/" } };
  }
  const title = `${instance.name}: your community, courses, and events in one place`;
  return {
    title: { absolute: title },
    description: landingDescription,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: instance.name,
      title,
      description: landingDescription,
      url: "/",
    },
  };
}

export default async function HomePage({ searchParams }: PageProps) {
  const [rows, params] = await Promise.all([loadMyCommunities(), searchParams]);
  const config = getPlatformConfig();
  const destination = homeDestination({
    slugs: rows ? rows.map((row) => row.community.slug) : null,
    showList: params["home"] === "1",
    homeCommunity: config.homeCommunity,
    edition: config.edition,
  });
  if (destination.kind === "redirect") {
    redirect(destination.href);
  }
  if (destination.kind === "landing") {
    return (
      <MarketingShell>
        <CloudLanding pricing={loadCloudPricing()} />
      </MarketingShell>
    );
  }
  return (
    <PlatformLayout>
      {rows ? (
        <MyCommunities rows={rows} />
      ) : (
        <SignedOutHome
          instance={config.instance}
          creatorSignUp={config.signUpMode === "open" && config.communityCreation.mode === "anyone"}
        />
      )}
    </PlatformLayout>
  );
}

const quietLink =
  "inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

async function MyCommunities({ rows }: { rows: readonly MyCommunity[] }) {
  const config = getPlatformConfig();
  const session = await currentSession();
  const email = session?.user.email ?? "";
  const canCreate = canCreateCommunities(config.communityCreation, email);
  const earlyAccess = session ? earlyAccessLinkFor(email) : null;
  const earlyAccessLink = earlyAccess ? (
    <Link href={earlyAccess} className={quietLink}>
      Request early access
    </Link>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold text-text">My communities</h1>
        <EmptyState
          icon={UsersRound}
          title="You haven't joined a community yet"
          action={
            canCreate ? (
              <Button asChild>
                <Link href="/communities/new">Create your first community</Link>
              </Button>
            ) : (
              earlyAccessLink
            )
          }
        >
          {canCreate
            ? "Start your own, or open an invite link to join someone else's."
            : "Open an invite link to join a community."}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-text">My communities</h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <MyCommunityCard
            key={row.community.id}
            community={row.community}
            role={row.membership.role}
            unread={row.unread}
          />
        ))}
      </ul>
      {canCreate ? (
        <Link href="/communities/new" className={quietLink}>
          <Plus aria-hidden="true" className="size-4" />
          Create a community
        </Link>
      ) : (
        earlyAccessLink
      )}
    </div>
  );
}
