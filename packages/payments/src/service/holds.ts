import { communityIdSchema, type CommunityId } from "@cohory/db";

import type { DueHold, HoldRelease } from "../holds/store";
import type { Runtime } from "./context";

export const holdExpiryBatch = 100;
const inFlightRetryMs = 60 * 60 * 1000;

export interface HoldExpiryResult {
  readonly released: number;
  readonly kept: number;
  readonly failed: number;
}

export interface HoldOperations {
  expireMembershipHolds(): Promise<HoldExpiryResult>;
}

export function releaseHold(
  runtime: Runtime,
  communityId: CommunityId,
  userId: string,
): Promise<HoldRelease> {
  const now = runtime.now();
  return runtime.repo.inCommunityAsSystem(communityId, (store) =>
    store.holds.release(userId, now, new Date(now.getTime() + inFlightRetryMs)),
  );
}

export async function releaseEach(
  due: readonly DueHold[],
  release: (hold: DueHold) => Promise<HoldRelease>,
  defer: (hold: DueHold) => Promise<void>,
  log: Runtime["log"],
): Promise<HoldExpiryResult> {
  let released = 0;
  let kept = 0;
  let failed = 0;
  for (const hold of due) {
    try {
      const outcome = await release(hold);
      if (outcome === "released") {
        released += 1;
      } else if (outcome === "kept") {
        kept += 1;
      }
    } catch (error: unknown) {
      failed += 1;
      log({
        msg: "membership hold release failed",
        level: "error",
        communityId: hold.communityId,
        userId: hold.userId,
        error: error instanceof Error ? error.name : "unknown",
      });
      try {
        await defer(hold);
      } catch (deferError: unknown) {
        log({
          msg: "membership hold could not be moved back",
          level: "error",
          communityId: hold.communityId,
          userId: hold.userId,
          error: deferError instanceof Error ? deferError.name : "unknown",
        });
      }
    }
  }
  return { released, kept, failed };
}

export function createHoldOperations(runtime: Runtime): HoldOperations {
  return {
    async expireMembershipHolds() {
      const due = await runtime.repo.listDueHolds(runtime.now(), holdExpiryBatch);
      return releaseEach(
        due,
        (hold) => releaseHold(runtime, communityIdSchema.parse(hold.communityId), hold.userId),
        (hold) =>
          runtime.repo.inCommunityAsSystem(communityIdSchema.parse(hold.communityId), (store) =>
            store.holds.defer(hold.userId, new Date(runtime.now().getTime() + inFlightRetryMs)),
          ),
        runtime.log,
      );
    },
  };
}
