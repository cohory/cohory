import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema, type CommunityId } from "@cohory/db";

import { createExitEngine, type ExitRunResult } from "../exit/engine";
import { leftRunningSteps, selectExitTargets } from "../exit/rules";
import { latestExitRun } from "../exit/latest-run";
import type { ExitRunRecord } from "../exit/store";
import {
  DeletionBlockedByBillingError,
  ExitInProgressError,
  ManualCancellationRequiredError,
  PaymentsNotFoundError,
} from "../errors";
import { billingBlock, deleteFinished, deletionReady } from "../exit/kinds/delete";
import type { ExitRunJobPayload } from "../jobs";
import type { PaymentsStore } from "../repository";
import {
  toExitRunView,
  type ExitRunView,
  type PaidMembersConnection,
  type PaidMembersSummary,
} from "../views";
import { requireUserId, withAccess, type Runtime } from "./context";

export {
  createExitEngine,
  type ExitEngine,
  type ExitRunResult,
  type StartExitRun,
} from "../exit/engine";

export type ArchivePaidMembersChoice = "stop_at_period_end" | "keep_billing";

export interface BeginArchiveInput {
  readonly communityId: CommunityId;
  readonly actorId: string;
  readonly choice: ArchivePaidMembersChoice;
  readonly includeLinked: boolean;
}

export interface BeginDeletionInput {
  readonly communityId: CommunityId;
  readonly actorId: string;
  readonly includeLinked: boolean;
  readonly confirmedManualCancellation: boolean;
}

export type DeletionStart =
  { readonly kind: "ready" } | { readonly kind: "queued"; readonly runId: string };

type DeletionPlan =
  | { readonly kind: "ready" }
  | { readonly kind: "run"; readonly run: ExitRunRecord; readonly stripeWork: boolean };

export interface ExitOperations {
  getPaidMembersSummary(actor: Actor, communityId: string): Promise<PaidMembersSummary>;
  runExitRun(payload: ExitRunJobPayload): Promise<ExitRunResult>;
  retryExitRun(actor: Actor, communityId: string): Promise<ExitRunView>;
  beginArchive(input: BeginArchiveInput): Promise<ExitRunView | null>;
  beginDeletion(input: BeginDeletionInput): Promise<DeletionStart>;
  deletionReady(communityId: CommunityId): Promise<boolean>;
}

async function latestRunOf(store: PaymentsStore): Promise<ExitRunRecord | null> {
  return latestExitRun(store.exit);
}

async function viewOf(store: PaymentsStore, run: ExitRunRecord): Promise<ExitRunView> {
  const members = await store.exit.listSubscriptionMembers(run.failedSubscriptionIds);
  return toExitRunView(
    run,
    members.map((member) => ({ userId: member.userId, name: member.name })),
  );
}

export function createExitOperations(runtime: Runtime): ExitOperations {
  const engine = createExitEngine(runtime);

  return {
    runExitRun: (payload) => engine.run(payload),

    async getPaidMembersSummary(actor, communityId) {
      requireUserId(actor);
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        const open = await store.findOpenConnection();
        let connection: PaidMembersConnection = "none";
        if (open) {
          connection = open.status === "disconnecting" ? "disconnecting" : "open";
        } else if (await store.exit.hasClosedConnection()) {
          connection = "closed";
        }
        const scope = open?.id ?? null;
        const counts =
          connection === "none"
            ? { cohory: 0, linkedImports: 0 }
            : await store.exit.countExitSubscriptions(scope);
        const ending = open
          ? (await store.exit.listExitSubscriptions(open.id)).filter((sub) => sub.cancelAtPeriodEnd)
              .length
          : 0;
        const latest = await latestRunOf(store);
        const manualCancellation =
          connection === "none" || (await deletionReady(store.exit))
            ? 0
            : (await store.exit.listExitSubscriptions(null)).filter(
                (sub) => sub.connectionId !== open?.id,
              ).length;
        return {
          connection,
          cohory: counts.cohory,
          linkedImports: counts.linkedImports,
          endingAtPeriodEnd: ending,
          manualCancellation,
          run: latest ? await viewOf(store, latest) : null,
        };
      });
    },

    async retryExitRun(actor, communityId) {
      requireUserId(actor);
      const reset = await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "connect", "payment", context);
        await store.enableManagement();
        const latest = await latestRunOf(store);
        if (!latest || latest.status !== "failed") {
          throw new PaymentsNotFoundError("exit_run");
        }
        return store.exit.updateRun(latest.id, {
          status: "pending",
          attempts: 0,
          doneCount: 0,
          failedSubscriptionIds: [],
          finishedAt: null,
        });
      });
      await engine.dispatch(reset);
      const communityKey = communityIdSchema.parse(reset.communityId);
      return runtime.repo.inCommunityAsSystem(communityKey, async (store) => {
        const current = await store.exit.findRun(reset.id);
        return viewOf(store, current ?? reset);
      });
    },

    async beginDeletion(input) {
      const community = await runtime.repo.findCommunity(input.communityId);
      const plan = await runtime.repo.inCommunityAsSystem(
        input.communityId,
        async (store): Promise<DeletionPlan> => {
          if (await store.exit.findUnfinishedRun()) {
            throw new ExitInProgressError();
          }
          const open = await store.findOpenConnection();
          if (open?.status === "disconnecting") {
            throw new ExitInProgressError();
          }
          const block = billingBlock(await store.exit.billingBlockers());
          if (block) {
            throw new DeletionBlockedByBillingError(block);
          }
          if (await deletionReady(store.exit)) {
            return { kind: "ready" };
          }
          const subs = await store.exit.listExitSubscriptions(null);
          const unreachable = subs.filter((sub) => sub.connectionId !== open?.id);
          if (unreachable.length > 0 && !input.confirmedManualCancellation) {
            throw new ManualCancellationRequiredError(unreachable.length);
          }
          const confirmedAt = unreachable.length > 0 ? runtime.now() : null;
          if (!open) {
            const run = await store.exit.insertRun({
              id: runtime.newId(),
              kind: "delete",
              choice: "cancel_now",
              connectionId: null,
              includeLinked: input.includeLinked,
              requestedBy: input.actorId,
              portalLoginUrl: null,
              manualCancellationConfirmedAt: confirmedAt,
              targetCount: unreachable.length,
              status: "done",
            });
            const finished = await store.exit.updateRun(run.id, { finishedAt: runtime.now() });
            if (community) {
              await deleteFinished({
                run: finished,
                status: "done",
                community,
                actorId: input.actorId,
                completed: [],
                leftRunning: [],
                store,
                now: runtime.now(),
              });
            }
            return { kind: "ready" };
          }
          const reachable = subs.filter((sub) => sub.connectionId === open.id);
          const { targets, leftRunning } = selectExitTargets(reachable, input.includeLinked);
          const feeOnLeftRunning =
            leftRunningSteps("delete").includes("remove_fee") &&
            leftRunning.some((sub) => sub.applicationFeeBps > 0);
          const run = await engine.insertRun(store, {
            kind: "delete",
            choice: "cancel_now",
            connectionId: open.id,
            includeLinked: input.includeLinked,
            requestedBy: input.actorId,
            manualCancellationConfirmedAt: confirmedAt,
          });
          return { kind: "run", run, stripeWork: targets.length > 0 || feeOnLeftRunning };
        },
      );
      if (plan.kind === "ready") {
        return plan;
      }
      if (plan.stripeWork) {
        await engine.dispatch(plan.run);
        return { kind: "queued", runId: plan.run.id };
      }
      await engine.run({ runId: plan.run.id, communityId: plan.run.communityId });
      return { kind: "ready" };
    },

    deletionReady(communityId) {
      return runtime.repo.inCommunityAsSystem(communityId, (store) => deletionReady(store.exit));
    },

    async beginArchive(input) {
      const created = await runtime.repo.inCommunityAsSystem(input.communityId, async (store) => {
        const open = await store.findOpenConnection();
        if (!open) {
          return null;
        }
        const subs = await store.exit.listExitSubscriptions(open.id);
        if (selectExitTargets(subs, true).targets.length === 0) {
          return null;
        }
        return engine.insertRun(store, {
          kind: "archive",
          choice: input.choice,
          connectionId: open.id,
          includeLinked: input.includeLinked,
          requestedBy: input.actorId,
        });
      });
      if (!created) {
        return null;
      }
      if (input.choice === "keep_billing") {
        await engine.run({ runId: created.id, communityId: created.communityId });
      } else {
        await engine.dispatch(created);
      }
      return runtime.repo.inCommunityAsSystem(input.communityId, async (store) => {
        const current = await store.exit.findRun(created.id);
        return viewOf(store, current ?? created);
      });
    },
  };
}
