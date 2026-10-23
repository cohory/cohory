import { communityIdSchema } from "@cohory/db";

import type { PaymentsRepository } from "../repository";

export type PaidCommunityBlockers = (
  communityIds: readonly string[],
) => Promise<ReadonlySet<string>>;

export function createPaidCommunityBlockers(repo: PaymentsRepository): PaidCommunityBlockers {
  return async (communityIds) => {
    const blocked = new Set<string>();
    for (const id of new Set(communityIds)) {
      const communityId = communityIdSchema.parse(id);
      const billing = await repo.inCommunityAsSystem(communityId, async (store) => {
        if (await store.findOpenConnection()) {
          return true;
        }
        const counts = await store.exit.countExitSubscriptions(null);
        return counts.cohory + counts.linkedImports > 0;
      });
      if (billing) {
        blocked.add(communityId);
      }
    }
    return blocked;
  };
}
