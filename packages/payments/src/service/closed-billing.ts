import { compGrants } from "../access";
import type { Runtime } from "./context";

export const closedBillingBatch = 200;
export const closedBillingMaxBatches = 50;

export interface ClosedBillingResult {
  readonly ended: number;
}

export interface ClosedBillingOperations {
  endClosedBillingAccess(): Promise<ClosedBillingResult>;
}

export function createClosedBillingOperations(runtime: Runtime): ClosedBillingOperations {
  const { repo } = runtime;

  return {
    async endClosedBillingAccess() {
      const now = runtime.now();
      let ended = 0;
      for (let batch = 0; batch < closedBillingMaxBatches; batch += 1) {
        const due = await repo.listClosedBillingDue(now, closedBillingBatch);
        for (const row of due) {
          const remove = await repo.inCommunityAsSystem(row.communityId, async (store) => {
            await store.setSubscriptionAccessState(row.subscriptionId, "revoked");
            const member = await store.findMember(row.userId);
            const comp = await store.comps.findOpen(row.userId);
            return (
              member?.status === "active" && member.role === "member" && !compGrants(comp, now)
            );
          });
          if (remove) {
            await repo.removeMembership(row.communityId, row.userId);
          }
          ended += 1;
        }
        if (due.length < closedBillingBatch) {
          break;
        }
      }
      if (ended > 0) {
        runtime.log({ msg: "paid access ended after the creator disconnected", ended });
      }
      return { ended };
    },
  };
}
