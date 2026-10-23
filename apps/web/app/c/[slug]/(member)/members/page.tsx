import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "../../../../../components/empty-state";
import { LockedSection } from "../../../../../components/joining/locked-section";
import { DirectorySkeleton } from "../../../../../components/members/directory-skeleton";
import { MemberDirectory } from "../../../../../components/members/member-directory";
import { requireFullCommunityPage } from "../../../../../lib/communities/load";
import { memberCountLabel } from "../../../../../lib/format";
import { loadDirectory } from "../../../../../lib/members/load";
import { parseDirectoryParams, type DirectoryParams } from "../../../../../lib/members/params";

export const metadata: Metadata = { title: "Members" };

async function Directory({ slug, params }: { slug: string; params: DirectoryParams }) {
  const data = await loadDirectory(slug, params);
  if (data.status === "forbidden") {
    return (
      <EmptyState icon={Users} title="Members are visible to members">
        Join this community to see who is here.
      </EmptyState>
    );
  }
  return (
    <MemberDirectory
      slug={data.page.community.slug}
      params={params}
      initialMembers={data.members}
      initialCursor={data.nextCursor}
      gamificationEnabled={data.gamificationEnabled}
      levels={data.levels}
    />
  );
}

export default async function MembersPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/members">) {
  const directoryParams = parseDirectoryParams(await searchParams);
  const page = await requireFullCommunityPage((await params).slug);
  const { community } = page;
  if (page.role === null) {
    return <LockedSection page={page} kind="members" />;
  }

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="members-heading" className="text-xl text-text">
          Members{" "}
          <span className="text-text-muted tabular-nums" aria-hidden="true">
            {community.memberCount}
          </span>
          <span className="sr-only">, {memberCountLabel(community.memberCount)}</span>
        </h2>
        <Link
          href={`/c/${community.slug}/members/leaderboard`}
          className="text-sm font-medium text-accent outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          Leaderboard
        </Link>
      </div>
      <Suspense fallback={<DirectorySkeleton />}>
        <Directory slug={community.slug} params={directoryParams} />
      </Suspense>
    </section>
  );
}
