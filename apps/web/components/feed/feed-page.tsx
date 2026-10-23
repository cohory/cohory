import { CommunityPostSkeleton } from "@cohory/ui";
import { Lock } from "lucide-react";
import { Suspense } from "react";

import { canRsvpEvents, loadNextForViewer } from "../../lib/calendar/load";
import { viewerTimeZone } from "../../lib/calendar/viewer-time-zone";
import type { FullCommunityPage } from "../../lib/communities/load";
import { lessonHref } from "../../lib/courses/hrefs";
import { loadContinueLearning } from "../../lib/courses/load";
import { loadMyFeedProfile, loadWelcomeSteps } from "../../lib/onboarding/load";
import { feedHref, type FeedAudience, type FeedUrlState } from "../../lib/posts/feed-url";
import { loadFeed } from "../../lib/posts/load";
import { TimeZoneSync } from "../calendar/time-zone-sync";
import { EmptyState } from "../empty-state";
import { MomentQuestion } from "../feedback/moment-question";
import { CommunityFeed } from "./community-feed";
import { FeedHighlights } from "./feed-highlights";
import { FeedRail } from "./feed-rail";
import { FeedSortControl } from "./feed-sort";
import { OwnerSetupCard } from "./owner-setup-card";
import { WelcomeCard } from "./welcome-card";

const firstPostPlaceholder = "Write something to introduce yourself";
const introductionsSlug = "introductions";

async function Feed({
  page,
  state,
  audience,
  compose,
}: {
  page: FullCommunityPage;
  state: FeedUrlState;
  audience: FeedAudience;
  compose: boolean;
}) {
  const [feed, profile] = await Promise.all([loadFeed(page, state), loadMyFeedProfile(page)]);
  if (feed.status === "forbidden") {
    return (
      <EmptyState icon={Lock} title="Posts are visible to members">
        Join this community to read and write posts.
      </EmptyState>
    );
  }
  const user = page.session?.user;
  const slug = page.community.slug;
  const firstPost = profile !== null && !profile.hasPosted;
  const postable = (categorySlug: string | null) =>
    feed.categories.find((category) => category.slug === categorySlug && category.canPost)?.id ??
    null;
  const chips = [
    {
      key: "all",
      label: "All",
      href: feedHref(slug, { ...state, category: null }, audience),
      active: !state.category,
    },
    ...feed.categories.map((category) => ({
      key: category.id,
      label: category.name,
      href: feedHref(slug, { ...state, category: category.slug }, audience),
      active: state.category === category.slug,
      color: category.color,
    })),
  ];
  return (
    <CommunityFeed
      key={`${state.category ?? "all"}:${state.sort}`}
      slug={slug}
      category={state.category}
      sort={state.sort}
      sortControl={<FeedSortControl slug={slug} state={state} audience={audience} />}
      chips={feed.categories.length > 0 ? chips : []}
      composerCategories={feed.categories
        .filter((category) => category.canPost)
        .map((category) => ({ id: category.id, name: category.name }))}
      defaultCategoryId={
        postable(state.category) ?? (firstPost ? postable(introductionsSlug) : null)
      }
      composerPlaceholder={firstPost ? firstPostPlaceholder : undefined}
      composerOpen={compose}
      staffOnlyCategory={
        feed.canPost
          ? (feed.categories.find(
              (category) => category.slug === state.category && !category.canPost,
            )?.name ?? null)
          : null
      }
      editCategoriesHref={page.canManage ? `/c/${slug}/manage/settings/categories` : null}
      initialPosts={feed.posts}
      initialCursor={feed.nextCursor}
      canPost={feed.canPost}
      memberEmail={feed.memberEmail}
      lastVisitAt={feed.lastVisitAt}
      scheduledCount={feed.scheduledCount}
      canLike={feed.canLike}
      signedIn={page.session !== null}
      viewer={user ? { name: user.name, avatarUrl: user.image ?? null } : null}
    />
  );
}

async function UpNext({ page }: { page: FullCommunityPage }) {
  const [learning, next, zone] = await Promise.all([
    loadContinueLearning(page),
    loadNextForViewer(page),
    viewerTimeZone(),
  ]);
  const steps = await loadWelcomeSteps(page, learning, next);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: zone.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const slug = page.community.slug;
  return (
    <>
      <TimeZoneSync current={zone.cookie} />
      {steps ? <WelcomeCard slug={slug} communityName={page.community.name} steps={steps} /> : null}
      <FeedHighlights
        className="lg:hidden"
        slug={slug}
        canRsvp={canRsvpEvents(page)}
        learning={
          learning
            ? {
                lessonTitle: learning.lesson.title,
                percent: learning.progressPercent,
                href: lessonHref(slug, learning.course.slug, learning.lesson.slug),
              }
            : null
        }
        events={next
          .filter((occurrence) => !occurrence.canceled)
          .slice(0, learning ? 1 : 2)
          .map((occurrence) => ({
            occurrence,
            when: when.format(new Date(occurrence.startsAt)),
          }))}
      />
    </>
  );
}

function FeedSkeleton() {
  return (
    <div role="status" aria-label="Loading posts" className="-mx-4 flex flex-col gap-3 md:mx-0">
      <CommunityPostSkeleton />
      <CommunityPostSkeleton />
    </div>
  );
}

export function FeedPage({
  page,
  state,
  audience,
  compose = false,
}: {
  page: FullCommunityPage;
  state: FeedUrlState;
  audience: FeedAudience;
  compose?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        {page.role === "owner" ? (
          <Suspense fallback={null}>
            <MomentQuestion
              actor={page.actor}
              communityId={page.community.id}
              slug={page.community.slug}
            />
          </Suspense>
        ) : null}
        <Suspense fallback={null}>
          <OwnerSetupCard page={page} />
        </Suspense>
        <Suspense fallback={null}>
          <UpNext page={page} />
        </Suspense>
        <Suspense fallback={<FeedSkeleton />}>
          <Feed page={page} state={state} audience={audience} compose={compose} />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <FeedRail page={page} />
      </Suspense>
    </div>
  );
}
