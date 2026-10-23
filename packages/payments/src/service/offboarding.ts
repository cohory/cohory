import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";

import { createExitEngine } from "../exit/engine";
import { closeAfterDisconnect, recipientsFromMirror } from "../exit/kinds/disconnect";
import {
  ExitInProgressError,
  FeeRemovalIncompleteError,
  NotConnectedError,
  PaymentsNotFoundError,
} from "../errors";
import { disconnectInputSchema, type DisconnectInput } from "../schemas";
import { toConnectionView, type ConnectionView } from "../views";
import {
  callStripe,
  parse,
  providerFor,
  requireUserId,
  splitsFees,
  withAccess,
  type Runtime,
} from "./context";

export interface FeeRemovalResult {
  readonly cleared: number;
  readonly remaining: number;
}

export interface OffboardingOperations {
  disconnectStripe(
    actor: Actor,
    communityId: string,
    input?: DisconnectInput,
  ): Promise<ConnectionView>;
  forceDisconnect(actor: Actor, communityId: string): Promise<ConnectionView>;
  removeApplicationFees(connectionId: string): Promise<FeeRemovalResult>;
}

export function createOffboardingOperations(runtime: Runtime): OffboardingOperations {
  const { repo } = runtime;
  const engine = createExitEngine(runtime);

  async function currentView(connectionId: string | null): Promise<ConnectionView> {
    const connection = connectionId ? await repo.findConnectionById(connectionId) : null;
    if (!connection) {
      throw new PaymentsNotFoundError("connection");
    }
    return toConnectionView(connection);
  }

  async function removeApplicationFees(connectionId: string): Promise<FeeRemovalResult> {
    const connection = await repo.findConnectionById(connectionId);
    if (!connection || !splitsFees(runtime, connection) || !connection.externalAccountId) {
      return { cleared: 0, remaining: 0 };
    }
    const communityId = communityIdSchema.parse(connection.communityId);
    const { provider, conn } = providerFor(runtime, connection);
    const setPlatformFee = provider.setPlatformFee?.bind(provider);
    if (!setPlatformFee) {
      return { cleared: 0, remaining: 0 };
    }
    const pending = await repo.inCommunityAsSystem(communityId, (store) =>
      store.listSubscriptionsWithFee(connection.id),
    );
    let cleared = 0;
    let remaining = 0;
    for (const subscription of pending) {
      const externalId = subscription.externalSubscriptionId;
      try {
        const updated = await callStripe(runtime, () =>
          setPlatformFee(externalId, 0, `disconnect:${connection.id}:${externalId}`, conn),
        );
        if (updated.applicationFeePercent !== null && updated.applicationFeePercent > 0) {
          remaining += 1;
          continue;
        }
        await repo.inCommunityAsSystem(communityId, (store) =>
          store.setSubscriptionFeeBps(subscription.id, 0),
        );
        cleared += 1;
      } catch (error: unknown) {
        remaining += 1;
        runtime.log({
          msg: "could not remove the platform fee from a subscription",
          level: "error",
          connectionId: connection.id,
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    runtime.log({
      msg: "platform fee removal finished",
      level: remaining > 0 ? "warn" : "info",
      connectionId: connection.id,
      cleared,
      remaining,
    });
    if (remaining > 0) {
      throw new FeeRemovalIncompleteError(connection.id, remaining);
    }
    return { cleared, remaining };
  }

  return {
    removeApplicationFees,

    async disconnectStripe(actor, communityId, input = {}) {
      const userId = requireUserId(actor);
      const choice = parse(disconnectInputSchema, input);
      const run = await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "connect", "payment", context);
        await store.enableManagement();
        const connection = await store.findOpenConnection();
        if (!connection) {
          throw new NotConnectedError();
        }
        if (connection.status === "disconnecting") {
          throw new ExitInProgressError();
        }
        const record = await engine.insertRun(store, {
          kind: "disconnect",
          choice: choice.memberChoice,
          connectionId: connection.id,
          includeLinked: choice.includeLinked,
          requestedBy: userId,
          portalLoginUrl: choice.portalLoginUrl,
        });
        await store.updateConnection(connection.id, { status: "disconnecting" });
        return record;
      });
      await engine.dispatch(run);
      return currentView(run.connectionId);
    },

    async forceDisconnect(actor, communityId) {
      const userId = requireUserId(actor);
      const closed = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "connect", "payment", context);
          await store.enableManagement();
          const connection = await store.findOpenConnection();
          if (!connection || connection.status !== "disconnecting") {
            throw new NotConnectedError();
          }
          if (await store.exit.findUnfinishedRun()) {
            throw new ExitInProgressError();
          }
          const run = await store.exit.latestRun("disconnect");
          if (!run || run.status !== "failed" || run.connectionId !== connection.id) {
            throw new PaymentsNotFoundError("exit_run");
          }
          const recipients = await recipientsFromMirror(store, run);
          return closeAfterDisconnect(store, {
            run,
            connectionId: connection.id,
            community,
            actorId: userId,
            ...recipients,
            feeClearRequired: true,
            now: runtime.now(),
          });
        },
      );
      if (!closed) {
        throw new NotConnectedError();
      }
      runtime.log({
        msg: "connection closed after a failed disconnect run",
        level: "warn",
        connectionId: closed.id,
      });
      return toConnectionView(closed);
    },
  };
}
