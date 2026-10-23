import { can } from "@cohory/authz";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TimeZoneSync } from "../../../../../components/calendar/time-zone-sync";
import { ScheduledPosts } from "../../../../../components/feed/scheduled-posts";
import { viewerTimeZone } from "../../../../../lib/calendar/viewer-time-zone";
import { loadCommunityPage } from "../../../../../lib/communities/load";
import { loadScheduledPosts } from "../../../../../lib/posts/load";

export const metadata: Metadata = { title: "Scheduled posts" };

export default async function ScheduledPostsPage({
  params,
}: PageProps<"/c/[slug]/posts/scheduled">) {
  const page = await loadCommunityPage((await params).slug);
  if (page.access !== "full") notFound();
  const [{ rows, categories }, zone] = await Promise.all([
    loadScheduledPosts(page),
    viewerTimeZone(),
  ]);
  const slug = page.community.slug;
  const showAuthors = can(page.actor, "read_scheduled", "post", { role: page.role });

  return (
    <div className="flex flex-col gap-4">
      <TimeZoneSync current={zone.cookie} />
      <Link
        href={`/c/${slug}`}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-sm font-medium text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to the feed
      </Link>
      <h1 className="text-2xl font-semibold text-text">Scheduled posts</h1>
      <p className="text-sm text-text-muted">
        {showAuthors
          ? "Posts from everyone in this community that will publish later. Only the author can edit or post one early."
          : "Your posts that will publish later. Nobody else sees them until then."}
      </p>
      <ScheduledPosts
        slug={slug}
        rows={rows}
        categories={categories}
        showAuthors={showAuthors}
        timeZone={zone.timeZone}
      />
    </div>
  );
}
