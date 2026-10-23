import { CommunityTabs } from "../../../../../components/community-tabs";
import { PreviewBanner } from "../../../../../components/community-top/preview-banner";
import { VisitorHero } from "../../../../../components/community-top/visitor-hero";
import { loadPreviewGaps, loadVisitorHero } from "../../../../../lib/communities/about";
import { loadCommunityPage } from "../../../../../lib/communities/load";
import { previewParam } from "../../../../../lib/communities/preview";

export default async function AboutPreviewTop({
  params,
  searchParams,
}: PageProps<"/c/[slug]/about">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  if (search[previewParam] !== "1") {
    return null;
  }
  const page = await loadCommunityPage(slug);
  if (page.access !== "full" || page.role === null || !page.canManage) {
    return null;
  }
  const { community } = page;
  const [gaps, hero] = await Promise.all([
    loadPreviewGaps(community.slug),
    loadVisitorHero(community.slug, { preview: true }),
  ]);
  return (
    <>
      <PreviewBanner slug={community.slug} gaps={gaps} />
      <VisitorHero hero={hero} />
      {community.privacy === "public" ? (
        <CommunityTabs slug={community.slug} audience="visitor" />
      ) : null}
    </>
  );
}
