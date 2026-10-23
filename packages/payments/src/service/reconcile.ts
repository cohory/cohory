import { communityIdSchema, type CommunityId } from "@cohory/db";

import { accessStateFor, grants } from "../access";
import type { SubscriptionPage } from "../gateway";
import { reconcileConnectionJobPayloadSchema } from "../jobs";
import type { ProviderSubscriptionSummary } from "../providers/types";
import { reconcilableStatuses, type ConnectionRecord } from "../repository";
import { connectionFor, isProviderEnabled, parse, type Runtime } from "./context";
import { createNormalizedEventHandler, type Processing } from "./normalized-events";

export const reconcileWindowMs = 7 * 24 * 60 * 60_000;

const pageSize = 100;

export interface ReconcileSweepResult {
  readonly scheduled: number;
}

export interface ConnectionReconcileResult {
  readonly skipped: boolean;
  readonly complete: boolean;
  readonly subscriptions: number;
  readonly feeEvents: number;
}

export interface ReconcileOperations {
  scheduleConnectionReconciles(): Promise<ReconcileSweepResult>;
  reconcileConnection(
    connectionId: string,
    options?: { readonly budgetMs?: number },
  ): Promise<ConnectionReconcileResult>;
}

export const reconcileBudgetMs = 5 * 60_000;

const skipped: ConnectionReconcileResult = {
  skipped: true,
  complete: true,
  subscriptions: 0,
  feeEvents: 0,
};

function sameTime(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function reconcilable(connection: ConnectionRecord | null): connection is ConnectionRecord {
  return (
    connection !== null &&
    (reconcilableStatuses as readonly ConnectionRecord["status"][]).includes(connection.status)
  );
}

export function createReconcileOperations(runtime: Runtime): ReconcileOperations {
  const { repo } = runtime;
  const handle = createNormalizedEventHandler(runtime);

  async function drifted(
    communityId: CommunityId,
    summary: ProviderSubscriptionSummary,
  ): Promise<boolean> {
    const mirrored = await repo.inCommunityAsSystem(communityId, (store) =>
      store.findSubscriptionByExternal(summary.id),
    );
    if (!mirrored) {
      return (
        summary.metadata["cohory_community_id"] === communityId &&
        grants(accessStateFor(summary.status))
      );
    }
    return (
      mirrored.providerStatus !== summary.status ||
      mirrored.cancelAtPeriodEnd !== summary.cancelAtPeriodEnd ||
      !sameTime(mirrored.currentPeriodEnd, summary.currentPeriodEnd)
    );
  }

  interface Run {
    readonly work: Processing;
    readonly deadline: number;
    subscriptions: number;
    feeEvents: number;
  }

  function outOfTime(run: Run): boolean {
    return runtime.now().getTime() >= run.deadline;
  }

  async function resync(run: Run, subscriptionId: string): Promise<boolean> {
    if (outOfTime(run)) {
      return false;
    }
    await handle(run.work, { kind: "subscription_changed", subscriptionId });
    run.subscriptions += 1;
    return true;
  }

  async function resyncListed(run: Run, seen: Set<string>): Promise<boolean> {
    const { work } = run;
    const list = work.provider.listSubscriptions;
    if (!list) {
      return true;
    }
    let cursor: string | null = null;
    do {
      const page: SubscriptionPage = await list.call(work.provider, work.conn, {
        startingAfter: cursor,
        limit: pageSize,
      });
      for (const summary of page.items) {
        seen.add(summary.id);
        if ((await drifted(work.communityId, summary)) && !(await resync(run, summary.id))) {
          return false;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return true;
  }

  async function resyncUnlisted(run: Run, seen: ReadonlySet<string>): Promise<boolean> {
    const { work } = run;
    if (!work.provider.listSubscriptions) {
      return true;
    }
    const granting = await repo.inCommunityAsSystem(work.communityId, (store) =>
      store.listGrantingExternalIds(work.connection.id),
    );
    for (const subscriptionId of granting) {
      if (!seen.has(subscriptionId) && !(await resync(run, subscriptionId))) {
        return false;
      }
    }
    return true;
  }

  async function resyncFees(run: Run): Promise<boolean> {
    const { work } = run;
    const list = work.provider.listFeeActivity;
    if (!list) {
      return true;
    }
    const since = new Date(runtime.now().getTime() - reconcileWindowMs);
    const events = await list.call(work.provider, work.conn, since);
    for (const event of events) {
      if (outOfTime(run)) {
        return false;
      }
      await handle(work, event);
      run.feeEvents += 1;
    }
    return true;
  }

  const operations: ReconcileOperations = {
    async scheduleConnectionReconciles() {
      let scheduled = 0;
      let afterId: string | null = null;
      for (;;) {
        const ids = await repo.listReconcilableConnectionIds(afterId, pageSize);
        for (const connectionId of ids) {
          if (runtime.jobs) {
            await runtime.jobs.scheduleConnectionReconcile({ connectionId });
          } else {
            await operations.reconcileConnection(connectionId);
          }
          scheduled += 1;
        }
        if (ids.length < pageSize) {
          return { scheduled };
        }
        afterId = ids.at(-1) ?? null;
      }
    },

    async reconcileConnection(connectionId, options = {}) {
      const input = parse(reconcileConnectionJobPayloadSchema, { connectionId });
      const connection = await repo.findConnectionById(input.connectionId);
      if (!reconcilable(connection) || !isProviderEnabled(runtime.env, connection.provider)) {
        return skipped;
      }
      const work: Processing = {
        connection,
        communityId: communityIdSchema.parse(connection.communityId),
        provider: runtime.providers.get(connection.provider),
        conn: connectionFor(runtime, connection),
      };
      const run: Run = {
        work,
        deadline: runtime.now().getTime() + (options.budgetMs ?? reconcileBudgetMs),
        subscriptions: 0,
        feeEvents: 0,
      };
      const seen = new Set<string>();
      const complete =
        (await resyncListed(run, seen)) &&
        (await resyncUnlisted(run, seen)) &&
        (await resyncFees(run));
      return {
        skipped: false,
        complete,
        subscriptions: run.subscriptions,
        feeEvents: run.feeEvents,
      };
    },
  };
  return operations;
}
