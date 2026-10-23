import {
  findSubscriptionForUserIn,
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { memberships } from "@cohory/db/schema";
import type { DomainEvent } from "@cohory/events";
import { grants } from "@cohory/entitlements/access";
import { eq, inArray, ne } from "drizzle-orm";

import type { FanoutResult } from "./fanout";
import { upsertGroupedNotice } from "./grouped";

export type JoinNotifier = (events: readonly DomainEvent[]) => Promise<FanoutResult>;

export interface JoinNotifierDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const welcomingRoles = ["owner", "admin"] as const;

async function joinedPaying(queries: ScopedQueries, userId: string): Promise<boolean> {
  await setRlsValue(queries.tx, "user_id", userId);
  const subscription = await findSubscriptionForUserIn(queries, userId);
  return subscription !== null && grants(subscription.accessState);
}

export function createJoinNotifier(deps: JoinNotifierDeps): JoinNotifier {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;

  return async (events) => {
    let inserted = 0;
    for (const event of events) {
      if (event.type !== "member.joined" || event.payload.role === "owner") {
        continue;
      }
      const { communityId, userId } = event.payload;
      const scope = withCommunity(deps.db, parseCommunityId(communityId));
      inserted += await runInCommunity(scope, async (queries) => {
        if (await joinedPaying(queries, userId)) {
          return 0;
        }
        const hosts = await queries.tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            queries.where(
              memberships,
              eq(memberships.status, "active"),
              inArray(memberships.role, [...welcomingRoles]),
              ne(memberships.userId, userId),
            ),
          );
        let changed = 0;
        for (const host of hosts) {
          const notified = await upsertGroupedNotice(
            queries,
            {
              kind: "actors",
              type: "member_joined",
              subjectType: "community",
              subjectId: communityId,
              postId: null,
              userId: host.userId,
              actorId: userId,
            },
            { at: now(), newId: makeId },
          );
          changed += notified ? 1 : 0;
        }
        return changed;
      });
    }
    return { inserted };
  };
}

let defaultNotifier: JoinNotifier | undefined;

export function getJoinNotifier(): JoinNotifier {
  defaultNotifier ??= createJoinNotifier({ db: getDb() });
  return defaultNotifier;
}
