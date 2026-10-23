import { redirect } from "next/navigation";

import { FeedPage } from "../../../components/feed/feed-page";
import { aboutHref } from "../../../lib/communities/join-state";
import { loadCommunityPage } from "../../../lib/communities/load";
import { feedHref, parseFeedSearchParams } from "../../../lib/posts/feed-url";

export default async function CommunityFeedPage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const page = await loadCommunityPage((await params).slug);
  const query = await searchParams;
  const state = parseFeedSearchParams(query);

  if (page.access === "limited") {
    redirect(aboutHref(page.community.slug));
  }
  if (page.role === null) {
    const hasFeedState = query.category !== undefined || query.sort !== undefined;
    redirect(
      hasFeedState
        ? feedHref(page.community.slug, state, "visitor")
        : aboutHref(page.community.slug),
    );
  }
  return <FeedPage page={page} state={state} audience="member" compose={query.compose === "1"} />;
}
