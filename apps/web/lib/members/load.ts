import { ForbiddenError } from "@cohory/authz";
import { GamificationCommunityNotFoundError, getGamificationService } from "@cohory/gamification";
import type { LeaderboardWindow } from "@cohory/gamification";
import { getMembersService, MembersError } from "@cohory/members";
import type { LevelOption, MemberListItem } from "@cohory/ui";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireFullCommunityPage, type FullCommunityPage } from "../communities/load";
import { communityAccess } from "../posts/load";
import { canEditProfile, canListMembers, canReadLeaderboard } from "./permissions";
import type { DirectoryParams } from "./params";
import {
  levelOptions,
  toLeaderboardView,
  toMemberListItems,
  toProfileView,
  type LeaderboardView,
  type ProfileView,
} from "./views";

export async function loadLevelOptions(page: FullCommunityPage): Promise<LevelOption[]> {
  return levelOptions(
    await getMembersService().getGamificationSettings(page.actor, page.community.id),
  );
}

export type DirectoryData =
  | { readonly status: "forbidden"; readonly page: FullCommunityPage }
  | {
      readonly status: "ok";
      readonly page: FullCommunityPage;
      readonly members: MemberListItem[];
      readonly nextCursor: string | null;
      readonly gamificationEnabled: boolean;
      readonly levels: LevelOption[];
    };

export async function loadDirectory(slug: string, params: DirectoryParams): Promise<DirectoryData> {
  const page = await requireFullCommunityPage(slug);
  if (!canListMembers(communityAccess(page))) return { status: "forbidden", page };
  const [settings, result] = await Promise.all([
    getMembersService().getGamificationSettings(page.actor, page.community.id),
    getMembersService().searchMembers(page.actor, page.community.id, {
      query: params.q.trim() || undefined,
      level: params.level ?? undefined,
    }),
  ]);
  return {
    status: "ok",
    page,
    members: toMemberListItems(page.community.slug, result.data),
    nextCursor: result.nextCursor,
    gamificationEnabled: settings.enabled,
    levels: levelOptions(settings),
  };
}

export type LeaderboardData =
  | { readonly status: "forbidden"; readonly page: FullCommunityPage }
  | { readonly status: "ok"; readonly page: FullCommunityPage; readonly board: LeaderboardView };

export async function loadLeaderboard(
  slug: string,
  window: LeaderboardWindow,
): Promise<LeaderboardData> {
  const page = await requireFullCommunityPage(slug);
  if (!canReadLeaderboard(communityAccess(page))) return { status: "forbidden", page };
  try {
    const board = await getGamificationService().getLeaderboard(page.actor, page.community.id, {
      window,
    });
    return { status: "ok", page, board: toLeaderboardView(page.community.slug, board) };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof GamificationCommunityNotFoundError) {
      return { status: "forbidden", page };
    }
    throw error;
  }
}

export interface ProfileData {
  readonly page: FullCommunityPage;
  readonly profile: ProfileView;
  readonly canEdit: boolean;
}

export const loadProfile = cache(async (slug: string, userId: string): Promise<ProfileData> => {
  const page = await requireFullCommunityPage(slug);
  try {
    const profile = await getMembersService().getMemberProfile(
      page.actor,
      page.community.id,
      userId,
    );
    return {
      page,
      profile: toProfileView(page.community.slug, profile),
      canEdit: canEditProfile(communityAccess(page), profile.userId),
    };
  } catch (error) {
    if (error instanceof MembersError || error instanceof ForbiddenError) notFound();
    throw error;
  }
});
