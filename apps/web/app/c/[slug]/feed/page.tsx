import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FeedPage } from "../../../../components/feed/feed-page";
import { aboutHref } from "../../../../lib/communities/join-state";
import { loadCommunityPage } from "../../../../lib/communities/load";
import { feedHref, parseFeedSearchParams } from "../../../../lib/posts/feed-url";

export const metadata: Metadata = { title: "Community" };

export default async function VisitorFeedPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/feed">) {
  const page = await loadCommunityPage((await params).slug);
  const state = parseFeedSearchParams(await searchParams);

  if (page.access === "limited") {
    redirect(aboutHref(page.community.slug));
  }
  if (page.role !== null) {
    redirect(feedHref(page.community.slug, state));
  }
  return <FeedPage page={page} state={state} audience="visitor" />;
}
