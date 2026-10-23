import { communityIdSchema } from "@cohory/db";
import { z } from "zod";

import { PaymentsNotFoundError } from "../errors";
import type { SubscriberTenure } from "../tenure/store";
import type { Runtime } from "./context";

export const maxTenureLookup = 200;

const userIdsSchema = z.array(z.uuid()).max(maxTenureLookup);

export interface TenureOperations {
  listSubscriberTenure(
    communityId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, SubscriberTenure>>;
}

export function createTenureOperations(runtime: Runtime): TenureOperations {
  return {
    async listSubscriberTenure(communityId, userIds) {
      const parsed = communityIdSchema.safeParse(communityId);
      if (!parsed.success) {
        throw new PaymentsNotFoundError("community");
      }
      const ids = userIdsSchema.parse([...new Set(userIds)]);
      if (ids.length === 0) {
        return new Map();
      }
      const rows = await runtime.repo.inCommunityAsSystem(parsed.data, (store) =>
        store.tenure.listTenure(ids),
      );
      return new Map(rows.map((row) => [row.userId, row]));
    },
  };
}
