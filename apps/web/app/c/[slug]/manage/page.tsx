import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AgentApprovals } from "../../../../components/manage/overview/agent-approvals";
import { HealthCard } from "../../../../components/manage/overview/health-card";
import { NeedsYouCard } from "../../../../components/manage/overview/needs-you-card";
import { SetupChecklistCard } from "../../../../components/manage/overview/setup-checklist-card";
import { UsageCard } from "../../../../components/manage/usage-card";
import { PaymentsOverviewCard } from "../../../../components/payments/payments-overview-card";
import { Skeleton } from "../../../../components/skeleton";
import { feedbackHref, sendFeedbackLabel } from "../../../../lib/contact/feedback";
import { requireManagePage } from "../../../../lib/manage/load";
import type { OverviewViewer } from "../../../../lib/manage/overview";

export const metadata: Metadata = { title: "Manage" };

export default async function ManageOverviewPage({ params }: PageProps<"/c/[slug]/manage">) {
  const manage = await requireManagePage((await params).slug, "overview");
  const contact = legalLinks(getLegalConfig(), getPlatformConfig().edition).contact;
  const viewer: OverviewViewer = {
    actor: manage.actor,
    role: manage.role,
    communityId: manage.communityId,
    slug: manage.slug,
  };

  return (
    <>
      <h2 className="text-2xl font-semibold text-text">Overview</h2>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <SetupChecklistCard viewer={viewer} />
      </Suspense>
      <Suspense fallback={null}>
        <NeedsYouCard viewer={viewer} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PaymentsOverviewCard
          actor={manage.actor}
          communityId={manage.communityId}
          slug={manage.slug}
        />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <HealthCard viewer={viewer} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <UsageCard actor={manage.actor} communityId={manage.communityId} />
      </Suspense>
      <Suspense fallback={null}>
        <AgentApprovals viewer={viewer} />
      </Suspense>
      {contact ? (
        <p className="text-sm text-text-muted">
          Something missing or hard to find in Manage?{" "}
          <Link className="text-link" href={feedbackHref(`/c/${manage.slug}/manage`)}>
            {sendFeedbackLabel}
          </Link>
        </p>
      ) : null}
    </>
  );
}
