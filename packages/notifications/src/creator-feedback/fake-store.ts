import type { CommunityRole } from "@cohory/authz";
import type { CreatorExitAction, CreatorExitReason, CreatorMoment } from "@cohory/db/schema";

import type { CreatorFeedbackStore, MomentResponse } from "./store";

export interface FakeRow {
  readonly userId: string;
  readonly communityId: string | null;
  readonly kind: "moment" | "exit";
  readonly topic: CreatorMoment | CreatorExitAction;
  status: "pending" | MomentResponse;
  score: number | null;
  reason: CreatorExitReason | null;
  comment: string | null;
  readonly createdAt: Date;
  respondedAt: Date | null;
}

export interface FakeCommunity {
  readonly slug: string;
  readonly roles: Map<string, CommunityRole>;
}

export function createFakeStore() {
  const rows: FakeRow[] = [];
  const communities = new Map<string, FakeCommunity>();
  const optOuts = new Map<string, Date>();

  const store: CreatorFeedbackStore = {
    async standingIn(userId, communityId) {
      const community = communities.get(communityId);
      return community ? { role: community.roles.get(userId) ?? null, slug: community.slug } : null;
    },
    async ownerOf(communityId) {
      const community = communities.get(communityId);
      const owner = [...(community?.roles ?? [])].find(([, role]) => role === "owner");
      return community && owner ? { userId: owner[0], slug: community.slug } : null;
    },
    async optedOutAt(userId) {
      return optOuts.get(userId) ?? null;
    },
    async setOptedOut(userId, at) {
      if (at) optOuts.set(userId, at);
      else optOuts.delete(userId);
    },
    async lastMomentResponseAt(userId) {
      const times = rows
        .filter((row) => row.userId === userId && row.kind === "moment" && row.respondedAt)
        .map((row) => row.respondedAt?.getTime() ?? 0);
      return times.length > 0 ? new Date(Math.max(...times)) : null;
    },
    async oldestPendingMoment(userId, createdAfter) {
      const pending = rows
        .filter(
          (row) =>
            row.userId === userId &&
            row.kind === "moment" &&
            row.status === "pending" &&
            row.communityId !== null &&
            row.createdAt > createdAfter &&
            communities.get(row.communityId)?.roles.get(userId) === "owner",
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      return pending?.communityId
        ? { communityId: pending.communityId, moment: pending.topic as CreatorMoment }
        : null;
    },
    async insertPendingMoment({ userId, communityId, moment, at }) {
      if (rows.some((row) => row.communityId === communityId && row.topic === moment)) {
        return false;
      }
      rows.push({
        userId,
        communityId,
        kind: "moment",
        topic: moment,
        status: "pending",
        score: null,
        reason: null,
        comment: null,
        createdAt: at,
        respondedAt: null,
      });
      return true;
    },
    async respondToMoment({ userId, communityId, moment, status, score, comment, at }) {
      const row = rows.find(
        (candidate) =>
          candidate.userId === userId &&
          candidate.communityId === communityId &&
          candidate.topic === moment &&
          candidate.status === "pending",
      );
      if (!row) return false;
      row.status = status;
      row.score = score;
      row.comment = comment;
      row.respondedAt = at;
      return true;
    },
    async insertExit({ userId, communityId, action, reason, comment, at }) {
      rows.push({
        userId,
        communityId,
        kind: "exit",
        topic: action,
        status: "answered",
        score: null,
        reason,
        comment,
        createdAt: at,
        respondedAt: at,
      });
    },
    async removeCreatedBefore(cutoff) {
      const kept = rows.filter((row) => row.createdAt >= cutoff);
      const removed = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return removed;
    },
  };

  return {
    store,
    rows,
    optOuts,
    addCommunity(id: string, slug: string, roles: Record<string, CommunityRole>) {
      communities.set(id, { slug, roles: new Map(Object.entries(roles)) });
    },
  };
}
