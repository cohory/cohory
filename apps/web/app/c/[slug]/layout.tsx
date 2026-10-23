import { getPlatformConfig } from "@cohory/config/platform";
import type { PlanView } from "@cohory/payments";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { ArchivedBanner } from "../../../components/archived-banner";
import { CommunityTabs } from "../../../components/community-tabs";
import { CommunityTop } from "../../../components/community-top/community-top";
import { MemberTop } from "../../../components/community-top/member-top";
import { VisitorHero } from "../../../components/community-top/visitor-hero";
import { PlatformBar } from "../../../components/platform-bar";
import { PastDueBanner } from "../../../components/payments/past-due-banner";
import { loadVisitorHero } from "../../../lib/communities/about";
import {
  loadCommunityPage,
  type CommunityPage,
  type FullCommunityPage,
} from "../../../lib/communities/load";
import { communityShareMetadata } from "../../../lib/communities/share-metadata";
import { appUrl } from "../../../lib/manage/views";
import { loadActivePlan, paysBySubscription } from "../../../lib/payments/load";
import { manageSectionsFor } from "../../../lib/manage/sections";
import { accentRootCss, communityThemeProps } from "../../../lib/theme/community-theme";
import { loadCommunityAppearance } from "../../../lib/theme/load";

// notFound() throws an error carrying this digest, and Next exports no guard for it.
const notFoundDigest = "NEXT_HTTP_ERROR_FALLBACK;404";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "digest" in error && error.digest === notFoundDigest;
}

export async function generateMetadata({ params }: LayoutProps<"/c/[slug]">): Promise<Metadata> {
  try {
    const { community } = await loadCommunityPage((await params).slug);
    return {
      title: community.name,
      ...communityShareMetadata(community, appUrl(), getPlatformConfig().instance.name),
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { title: "Page not found" };
    }
    throw error;
  }
}

function MemberSection({
  page,
  paying,
  preview,
}: {
  page: FullCommunityPage;
  paying: boolean;
  preview: ReactNode;
}) {
  const { community } = page;
  const memberTop = (
    <>
      <MemberTop
        slug={community.slug}
        name={community.name}
        memberCount={community.memberCount}
        privacy={community.privacy}
        role={page.role}
        canManage={manageSectionsFor(page.role).length > 0}
        canLeave={page.canLeave}
        paying={paying}
      />
      <CommunityTabs slug={community.slug} />
    </>
  );
  if (!page.canManage) {
    return memberTop;
  }
  return (
    <Suspense fallback={memberTop}>
      <CommunityTop slug={community.slug} preview={preview}>
        {memberTop}
      </CommunityTop>
    </Suspense>
  );
}

async function payingFor(page: CommunityPage, plan: Promise<PlanView | null>): Promise<boolean> {
  if (page.access !== "full" || !page.canLeave || page.actor.kind !== "user") {
    return false;
  }
  return (await plan) ? paysBySubscription(page.community.id, page.actor.userId) : false;
}

export default async function CommunityLayout({
  params,
  children,
  preview,
}: LayoutProps<"/c/[slug]">) {
  const page = await loadCommunityPage((await params).slug);
  const { community } = page;
  const full = page.access === "full";
  const member = full && page.role !== null;
  const activePlan = loadActivePlan(community.id);
  const [appearance, plan, paying, hero] = await Promise.all([
    loadCommunityAppearance(community.id),
    activePlan,
    member ? payingFor(page, activePlan) : false,
    member ? null : loadVisitorHero(community.slug),
  ]);
  const { className: fontClassName, ...theme } = communityThemeProps(appearance);
  const rootAccent = accentRootCss(appearance);

  return (
    <div
      className={fontClassName ? `min-h-screen bg-bg ${fontClassName}` : "min-h-screen bg-bg"}
      {...theme}
    >
      {rootAccent ? <style>{rootAccent}</style> : null}
      <PlatformBar
        community={{ slug: community.slug, name: community.name, logoUrl: appearance.logoUrl }}
        searchable={full}
      />
      {member ? (
        <MemberSection page={page} paying={paying} preview={preview} />
      ) : (
        <>
          {hero ? <VisitorHero hero={hero} /> : null}
          {full ? <CommunityTabs slug={community.slug} audience="visitor" /> : null}
        </>
      )}
      <main
        id="content"
        className={
          full
            ? "mx-auto max-w-5xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-12"
            : "mx-auto max-w-5xl px-4 pt-6 pb-12"
        }
      >
        {full && page.community.archivedAt ? <ArchivedBanner /> : null}
        {full && plan && page.role === "member" && page.actor.kind === "user" ? (
          <Suspense fallback={null}>
            <PastDueBanner
              slug={community.slug}
              communityId={community.id}
              userId={page.actor.userId}
            />
          </Suspense>
        ) : null}
        {children}
      </main>
    </div>
  );
}
