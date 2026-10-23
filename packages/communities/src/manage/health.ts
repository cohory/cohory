import { assertCan, type Actor } from "@cohory/authz";

import { inManagedCommunity, type Runtime } from "./context";

const dayMs = 24 * 60 * 60 * 1000;

export interface HealthTrend {
  readonly current: number;
  readonly previous: number;
}

export interface HealthWindow {
  readonly now: Date;
  readonly weekStart: Date;
  readonly lastWeekStart: Date;
  readonly monthStart: Date;
}

export interface TopPost {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly likeCount: number;
  readonly commentCount: number;
}

export interface CommunityHealth {
  readonly members: HealthTrend;
  readonly newMembers: HealthTrend;
  readonly activeMembers7d: number;
  readonly activeMembers30d: number;
  readonly posts: HealthTrend;
  readonly comments: HealthTrend;
  readonly lessonsCompleted: HealthTrend;
  readonly newNotGreeted: number;
  readonly topPost: TopPost | null;
}

export function healthWindow(now: Date): HealthWindow {
  return {
    now,
    weekStart: new Date(now.getTime() - 7 * dayMs),
    lastWeekStart: new Date(now.getTime() - 14 * dayMs),
    monthStart: new Date(now.getTime() - 30 * dayMs),
  };
}

export function healthOperations(runtime: Runtime) {
  return {
    getCommunityHealth(actor: Actor, communityId: string): Promise<CommunityHealth> {
      return inManagedCommunity(runtime, actor, communityId, async ({ context, store }) => {
        assertCan(actor, "read", "settings", context);
        return store.communityHealth(healthWindow(runtime.now()));
      });
    },
  };
}
