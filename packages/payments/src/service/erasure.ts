import { communityIdSchema } from "@cohory/db";

import { StripeRejectedError } from "../errors";
import type { ConnectionRecord } from "../repository";
import { callStripe, providerFor, type Runtime } from "./context";

export interface BillingReleaseResult {
  readonly canceled: number;
  readonly customersDeleted: number;
  readonly skipped: number;
}

export interface ErasureOperations {
  releaseBillingForUser(communityId: string, userId: string): Promise<BillingReleaseResult>;
}

async function tolerateMissing(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error: unknown) {
    if (!(error instanceof StripeRejectedError && error.stripeCode === "resource_missing")) {
      throw error;
    }
  }
}

export function createErasureOperations(runtime: Runtime): ErasureOperations {
  const { repo } = runtime;

  return {
    async releaseBillingForUser(communityId, userId) {
      const parsed = communityIdSchema.parse(communityId);
      const { customers, open, forgotten } = await repo.inCommunityAsSystem(
        parsed,
        async (store) => ({
          customers: await store.erasure.listCustomers(userId),
          open: await store.erasure.listOpenSubscriptions(userId),
          forgotten: await store.erasure.forgetEmail(userId),
        }),
      );
      if (forgotten.moves + forgotten.links > 0) {
        runtime.log({
          msg: "moving offers forgotten for an erased account",
          communityId: parsed,
          ...forgotten,
        });
      }
      const connections = new Map<string, ConnectionRecord | null>();
      async function connectionOf(id: string): Promise<ConnectionRecord | null> {
        if (!connections.has(id)) {
          const connection = await repo.findConnectionById(id);
          connections.set(id, connection?.status === "disconnected" ? null : connection);
        }
        return connections.get(id) ?? null;
      }

      let canceled = 0;
      let customersDeleted = 0;
      let skipped = 0;
      for (const subscription of open) {
        const connection = await connectionOf(subscription.connectionId);
        if (!connection) {
          skipped += 1;
          continue;
        }
        const { provider, conn } = providerFor(runtime, connection);
        await tolerateMissing(() =>
          callStripe(runtime, () =>
            provider.cancelSubscription(
              subscription.externalSubscriptionId,
              { atPeriodEnd: false, idempotencyKey: `erase:${subscription.id}:cancel` },
              conn,
            ),
          ),
        );
        canceled += 1;
      }
      for (const customer of customers) {
        const connection = await connectionOf(customer.connectionId);
        if (!connection) {
          skipped += 1;
          continue;
        }
        const { provider, conn } = providerFor(runtime, connection);
        if (!provider.deleteCustomer) {
          skipped += 1;
          continue;
        }
        const deleteCustomer = provider.deleteCustomer.bind(provider);
        await tolerateMissing(() =>
          callStripe(runtime, () =>
            deleteCustomer(customer.externalCustomerId, `erase:${customer.id}:delete`, conn),
          ),
        );
        customersDeleted += 1;
      }
      if (canceled + customersDeleted + skipped > 0) {
        runtime.log({
          msg: "billing released for an erased account",
          communityId: parsed,
          canceled,
          customersDeleted,
          skipped,
        });
      }
      return { canceled, customersDeleted, skipped };
    },
  };
}
