import {
  getPaymentsService,
  MembershipChangeUnavailableError,
  type CancelOverview,
} from "@cohory/payments";
import type { Actor } from "@cohory/authz";
import { formatBillingDate, formatMoney } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CancelMembership } from "../../../../../components/payments/cancel-membership";
import { loadCommunityPage } from "../../../../../lib/communities/load";

export const metadata: Metadata = { title: "Cancel membership" };

const linkClass =
  "rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

async function overviewFor(actor: Actor, communityId: string): Promise<CancelOverview | null> {
  if (actor.kind !== "user") {
    return null;
  }
  try {
    return await getPaymentsService().getCancelOverview(actor, communityId);
  } catch (error) {
    if (error instanceof MembershipChangeUnavailableError) return null;
    throw error;
  }
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

export default async function CancelMembershipPage({
  params,
}: PageProps<"/c/[slug]/membership/cancel">) {
  const { slug } = await params;
  const { community, actor } = await loadCommunityPage(slug);
  const membership = `/c/${community.slug}/membership`;
  const overview = await overviewFor(actor, community.id);
  if (!overview) {
    redirect(membership);
  }
  const { usage, price } = overview;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold text-text">Cancel membership</h2>
      <div className="flex max-w-xl flex-col gap-2 text-sm text-text">
        <p>
          So far in {overview.communityName} you finished{" "}
          {count(usage.lessonsDone, "lesson", "lessons")}, went to{" "}
          {count(usage.eventsAttended, "event", "events")}, and wrote{" "}
          {count(usage.posts, "post", "posts")}.
        </p>
        {price ? (
          <p>
            You pay {formatMoney(price.amountMinor, price.currency)} per {price.interval}.
          </p>
        ) : null}
        {overview.accessEndsAt ? (
          <p>
            If you cancel, you keep access until {formatBillingDate(overview.accessEndsAt)} and
            aren&apos;t charged again.
          </p>
        ) : null}
      </div>
      <CancelMembership
        slug={community.slug}
        communityName={overview.communityName}
        yearly={overview.yearly}
        canPause={overview.canPause}
      />
      <Link href={membership} className={`self-start text-sm ${linkClass}`}>
        Keep my membership
      </Link>
    </div>
  );
}
