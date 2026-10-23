import { z } from "zod";
import { assertCan, can, UnauthenticatedError, type Actor } from "@cohory/authz";
import {
  communityIdSchema,
  getCommunityById,
  getDb,
  getMembership,
  newId,
  runInCommunity,
  withCommunity,
  type Community,
  type Database,
} from "@cohory/db";
import { getCommunityAccess, noCommunityAccess } from "@cohory/entitlements/access";
import type { PostEvent } from "@cohory/posts";

import { GamificationCommunityNotFoundError, GamificationValidationError } from "./errors";
import { recordPoints, type PointsResult } from "./handler";
import {
  leaderboardInputSchema,
  leaderboardSize,
  rankAllTime,
  rankWindow,
  membersPerLevel,
  rollingWindowDays,
  viewerStats,
  type LeaderboardInput,
  type RankedRow,
} from "./leaderboard";
import {
  insertLearningPoints,
  listLearningPointsCommunities,
  type LearningActivity,
  type LearningPointsCommunity,
} from "./learning";
import { ladderOf, levelName } from "./levels";
import {
  resetAllPoints,
  resetMemberPoints,
  resetPointsInputSchema,
  type PointsResetResult,
  type ResetPointsInput,
} from "./reset";
import { rebuildStats } from "./stats";
import type { Leaderboard, LeaderboardEntry } from "./views";

export interface GamificationServiceDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface GamificationService {
  readonly recordPostEvents: (events: readonly PostEvent[]) => Promise<PointsResult>;
  recomputeMemberStats(communityId: string): Promise<{ readonly members: number }>;
  learningPointsCommunities(): Promise<LearningPointsCommunity[]>;
  recordLearningActivities(
    communityId: string,
    activities: readonly LearningActivity[],
  ): Promise<PointsResult>;
  getLeaderboard(actor: Actor, communityId: string, input?: LeaderboardInput): Promise<Leaderboard>;
  resetPoints(
    actor: Actor,
    communityId: string,
    input: ResetPointsInput,
  ): Promise<PointsResetResult>;
  resetMemberPoints(actor: Actor, communityId: string, userId: string): Promise<PointsResetResult>;
}

const dayMs = 24 * 60 * 60 * 1000;

async function loadCommunity(db: Database, communityId: string): Promise<Community> {
  const parsed = communityIdSchema.safeParse(communityId);
  const community = parsed.success ? await getCommunityById(db, parsed.data) : null;
  if (!community) {
    throw new GamificationCommunityNotFoundError();
  }
  return community;
}

export function createGamificationService(deps: GamificationServiceDeps): GamificationService {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;

  return {
    recordPostEvents(events) {
      return recordPoints(deps.db, events, makeId);
    },

    async recomputeMemberStats(communityId) {
      const community = await loadCommunity(deps.db, communityId);
      const members = await runInCommunity(withCommunity(deps.db, community.id), rebuildStats);
      return { members };
    },

    learningPointsCommunities() {
      return listLearningPointsCommunities(deps.db);
    },

    async recordLearningActivities(communityId, activities) {
      const community = await loadCommunity(deps.db, communityId);
      if (!community.gamificationEnabled) return { inserted: 0 };
      const enabled = { lesson: community.pointsForLessons, event: community.pointsForEvents };
      const awarded = activities.filter((activity) => enabled[activity.kind]);
      if (awarded.length === 0) return { inserted: 0 };
      const inserted = await runInCommunity(withCommunity(deps.db, community.id), (queries) =>
        insertLearningPoints(queries, awarded, makeId),
      );
      return { inserted };
    },

    async resetPoints(actor, communityId, input) {
      if (actor.kind !== "user") {
        throw new UnauthenticatedError();
      }
      const parsed = resetPointsInputSchema.safeParse(input);
      const community = await loadCommunity(deps.db, communityId);
      const scope = withCommunity(deps.db, community.id);
      const membership = await getMembership(scope, actor.userId);
      const role = membership?.status === "active" ? membership.role : null;
      const context = { role, communityPrivacy: community.privacy };
      if (!can(actor, "read", "community", context)) {
        throw new GamificationCommunityNotFoundError();
      }
      assertCan(actor, "reset_points", "membership", context);
      if (!parsed.success || parsed.data.confirmation.trim() !== community.name.trim()) {
        throw new GamificationValidationError([
          { path: "confirmation", message: `Type ${community.name} to confirm.` },
        ]);
      }
      return runInCommunity(scope, (queries) =>
        resetAllPoints(queries, { actorId: actor.userId, at: now(), makeId }),
      );
    },

    async resetMemberPoints(actor, communityId, userId) {
      if (actor.kind !== "user") {
        throw new UnauthenticatedError();
      }
      const community = await loadCommunity(deps.db, communityId);
      const scope = withCommunity(deps.db, community.id);
      const membership = await getMembership(scope, actor.userId);
      const role = membership?.status === "active" ? membership.role : null;
      const context = { role, communityPrivacy: community.privacy };
      if (!can(actor, "read", "community", context)) {
        throw new GamificationCommunityNotFoundError();
      }
      assertCan(actor, "reset_points", "membership", context);
      const target = z.uuid().safeParse(userId);
      if (!target.success) {
        throw new GamificationValidationError([{ path: "userId", message: "Choose a member." }]);
      }
      return runInCommunity(scope, (queries) =>
        resetMemberPoints(queries, {
          actorId: actor.userId,
          at: now(),
          makeId,
          userId: target.data,
        }),
      );
    },

    async getLeaderboard(actor, communityId, input = {}) {
      const parsed = leaderboardInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new GamificationValidationError(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        );
      }
      const { window } = parsed.data;
      const community = await loadCommunity(deps.db, communityId);
      const scope = withCommunity(deps.db, community.id);
      const viewerId = actor.kind === "user" ? actor.userId : null;
      const { role, entitled } = viewerId
        ? await getCommunityAccess(scope, viewerId, now())
        : noCommunityAccess;
      const context = { role, communityPrivacy: community.privacy, entitled };
      if (!can(actor, "read", "community", context)) {
        throw new GamificationCommunityNotFoundError();
      }
      assertCan(actor, "read", "leaderboard", context);
      if (!community.gamificationEnabled) {
        return { status: "disabled" };
      }
      const since = window === "7d" ? new Date(now().getTime() - rollingWindowDays * dayMs) : null;
      return runInCommunity(scope, async (queries) => {
        const rows = since
          ? await rankWindow(queries, viewerId, since)
          : await rankAllTime(queries, viewerId);
        const named = (row: RankedRow): LeaderboardEntry => ({
          ...row,
          levelName: levelName(row.level, community.levelNames),
        });
        const own = rows.find((row) => row.userId === viewerId);
        const entries = rows.filter((row) => row.rank <= leaderboardSize).map(named);
        const stats = viewerId && role ? await viewerStats(queries, viewerId) : null;
        return {
          status: "enabled",
          window,
          since,
          entries,
          viewer: stats
            ? {
                rank: own?.rank ?? null,
                points: own?.points ?? 0,
                totalPoints: stats.points,
                level: stats.level,
                levelName: levelName(stats.level, community.levelNames),
              }
            : null,
          ladder: ladderOf(community.levelNames, await membersPerLevel(queries)),
          earning: { lessons: community.pointsForLessons, events: community.pointsForEvents },
        };
      });
    },
  };
}

let defaultService: GamificationService | undefined;

export function getGamificationService(): GamificationService {
  defaultService ??= createGamificationService({ db: getDb() });
  return defaultService;
}
