import { assertCan, type Actor } from "@cohory/authz";
import type { PaymentProvider } from "@cohory/db/schema";

import { ExitInProgressError, NotConnectedError } from "../errors";
import { awaitsOwnerReview, toConnectionView, type ConnectionView } from "../views";
import { requireUserId, withAccess, type Runtime } from "./context";

export interface OwnershipReview {
  readonly previousOwnerName: string | null;
  readonly provider: PaymentProvider;
  readonly cohory: number;
  readonly linkedImports: number;
}

export interface OwnershipOperations {
  getOwnershipReview(actor: Actor, communityId: string): Promise<OwnershipReview | null>;
  keepPaymentAccount(actor: Actor, communityId: string): Promise<ConnectionView>;
}

export function createOwnershipOperations(runtime: Runtime): OwnershipOperations {
  return {
    async getOwnershipReview(actor, communityId) {
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "connect", "payment", context);
        await store.enableManagement();
        const connection = await store.findOpenConnection();
        if (
          !connection ||
          connection.status === "disconnecting" ||
          !awaitsOwnerReview(connection, userId)
        ) {
          return null;
        }
        const counts = await store.exit.countExitSubscriptions(connection.id);
        return {
          previousOwnerName: connection.acceptedOwnerId
            ? await store.findUserName(connection.acceptedOwnerId)
            : null,
          provider: connection.provider,
          cohory: counts.cohory,
          linkedImports: counts.linkedImports,
        };
      });
    },

    async keepPaymentAccount(actor, communityId) {
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "connect", "payment", context);
        await store.enableManagement();
        const connection = await store.findOpenConnection();
        if (!connection) {
          throw new NotConnectedError();
        }
        if (connection.status === "disconnecting") {
          throw new ExitInProgressError();
        }
        if (!awaitsOwnerReview(connection, userId)) {
          return toConnectionView(connection);
        }
        const kept = await store.updateConnection(connection.id, { acceptedOwnerId: userId });
        runtime.log({
          msg: "new owner kept the payment connection",
          level: "info",
          connectionId: kept.id,
        });
        return toConnectionView(kept);
      });
    },
  };
}
