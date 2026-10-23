import { maxBioLength } from "@cohory/members";
import { ActivityList } from "@cohory/ui";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProfileHeader } from "../../../../../../components/members/profile-header";
import { loadProfile } from "../../../../../../lib/members/load";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/members/[userId]">): Promise<Metadata> {
  const { slug, userId } = await params;
  const { profile } = await loadProfile(slug, userId);
  return { title: profile.member.name };
}

export default async function MemberProfilePage({
  params,
}: PageProps<"/c/[slug]/members/[userId]">) {
  const { slug, userId } = await params;
  const { page, profile, canEdit } = await loadProfile(slug, userId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/c/${page.community.slug}/members`}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-text-muted outline-none hover:text-text focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Members
      </Link>
      <ProfileHeader
        slug={page.community.slug}
        member={profile.member}
        bio={profile.bio}
        canEdit={canEdit}
        gamificationEnabled={profile.gamificationEnabled}
        nextLevelAt={profile.nextLevelAt}
        bioMaxLength={maxBioLength}
      />
      <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
        <h2 id="activity-heading" className="text-lg font-semibold text-text">
          Recent activity
        </h2>
        <div className="rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-2">
          <ActivityList items={profile.activity} />
        </div>
      </section>
    </div>
  );
}
