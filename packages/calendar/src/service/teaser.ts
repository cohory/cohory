import { can, type Actor, type PolicyContext } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";
import { noCommunityAccess } from "@cohory/entitlements/access";

import { CalendarNotFoundError } from "../errors";
import type { NextEventTeaser } from "../views";
import type { Runtime } from "./context";

export interface TeaserOperations {
  nextEventTeaser(actor: Actor, communityId: string): Promise<NextEventTeaser | null>;
}

const teaserWindowMs = 90 * 24 * 60 * 60 * 1000;

export function createTeaserOperations(runtime: Runtime): TeaserOperations {
  return {
    async nextEventTeaser(actor, communityId) {
      const parsed = communityIdSchema.safeParse(communityId);
      const community = parsed.success ? await runtime.repo.findCommunity(parsed.data) : null;
      if (!community) {
        throw new CalendarNotFoundError("community");
      }
      const viewerId = actor.kind === "user" ? actor.userId : null;
      const now = runtime.now();
      return runtime.repo.inCommunity(community.id, viewerId, async (store) => {
        const { role, entitled } = viewerId
          ? await store.findAccess(viewerId, now)
          : noCommunityAccess;
        const context: PolicyContext = { role, communityPrivacy: community.privacy, entitled };
        const next = await store.findNextOccurrence(now, new Date(now.getTime() + teaserWindowMs));
        if (!next) {
          return null;
        }
        if (
          can(actor, "read", "community", context) &&
          can(actor, "read_title", "event", context)
        ) {
          return { kind: "event", title: next.event.title, startsAt: next.occurrence.startsAt };
        }
        return { kind: "date", date: next.occurrence.startsAt.toISOString().slice(0, 10) };
      });
    },
  };
}
