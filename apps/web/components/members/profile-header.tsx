"use client";

import { MemberProfileHeader, type MemberSummary } from "@cohory/ui";
import { useRouter } from "next/navigation";

import { updateBioAction } from "../../lib/members/actions";

export interface ProfileHeaderProps {
  slug: string;
  member: MemberSummary;
  bio: string | null;
  canEdit: boolean;
  gamificationEnabled: boolean;
  nextLevelAt: number | null;
  bioMaxLength: number;
}

export function ProfileHeader({
  slug,
  member,
  bio,
  canEdit,
  gamificationEnabled,
  nextLevelAt,
  bioMaxLength,
}: ProfileHeaderProps) {
  const router = useRouter();

  return (
    <MemberProfileHeader
      member={member}
      bio={bio}
      canEdit={canEdit}
      onEditBio={
        canEdit
          ? async (next) => {
              const result = await updateBioAction({ slug, bio: next });
              if (!result.ok) throw new Error(result.message);
              router.refresh();
            }
          : undefined
      }
      gamificationEnabled={gamificationEnabled}
      nextLevelAt={nextLevelAt}
      bioMaxLength={bioMaxLength}
    />
  );
}
