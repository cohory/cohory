import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";

import { AboutCommunity } from "../../../../components/about-community";
import { LegalFooter } from "../../../../components/legal-footer";
import {
  loadAboutBody,
  loadCoursePreviews,
  loadVisitorHero,
} from "../../../../lib/communities/about";
import { aboutShareMetadata } from "../../../../lib/communities/share-metadata";
import { loadCommunityPage, type CommunityPage } from "../../../../lib/communities/load";
import { previewParam } from "../../../../lib/communities/preview";
import { appUrl } from "../../../../lib/manage/views";
import { loadReviewSlots } from "../../../../lib/reviews/slots";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/about">): Promise<Metadata> {
  const { community } = await loadCommunityPage((await params).slug);
  return aboutShareMetadata(community, appUrl(), getPlatformConfig().instance.name);
}

function isMember(page: CommunityPage): boolean {
  return page.access === "full" && page.role !== null;
}

function isPreview(page: CommunityPage, preview: string | string[] | undefined): boolean {
  return preview === "1" && page.access === "full" && page.role !== null && page.canManage;
}

export default async function CommunityAboutPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/about">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const page = await loadCommunityPage(slug);
  const preview = isPreview(page, search[previewParam]);
  const visitorView = preview || !isMember(page);
  const [about, slots, hero, courses] = await Promise.all([
    loadAboutBody(page.community.slug),
    loadReviewSlots(page, { preview }),
    visitorView ? loadVisitorHero(page.community.slug, { preview }) : null,
    visitorView ? loadCoursePreviews(page.community.slug) : [],
  ]);
  return (
    <>
      <AboutCommunity
        about={about}
        reviews={slots.reviews}
        join={hero ? { hero, aboveTabs: page.community.privacy === "public" } : null}
        courses={courses}
      />
      <LegalFooter className="mt-12" />
    </>
  );
}
