import { communityIdSchema, type CommunityId } from "@cohory/db";

import { ExitRunIncompleteError, PaymentsNotFoundError } from "../errors";
import type { GatewaySubscription } from "../gateway";
import { exitRunJobPayloadSchema, type ExitRunJobPayload } from "../jobs";
import type { ConnectionRecord, PaymentsStore } from "../repository";
import { callStripe, parse, providerFor, type Runtime } from "../service/context";
import { compGrants } from "../access";
import { archiveFinished } from "./kinds/archive";
import { deleteFinished } from "./kinds/delete";
import { disconnectFinished } from "./kinds/disconnect";
import type { ExitKindHook, ExitTargetResult } from "./kinds/types";
import {
  exitRunOutcome,
  isExitEligible,
  leftRunningSteps,
  selectExitTargets,
  stepsFor,
  type SubscriptionStep,
} from "./rules";
import type { ExitChoice, ExitKind, ExitRunRecord, ExitRunStatus, ExitSubscription } from "./store";

export interface StartExitRun {
  readonly kind: ExitKind;
  readonly choice: ExitChoice;
  readonly connectionId: string | null;
  readonly includeLinked: boolean;
  readonly requestedBy: string;
  readonly portalLoginUrl?: string | null;
  readonly manualCancellationConfirmedAt?: Date | null;
}

export interface ExitRunResult {
  readonly kind: ExitKind;
  readonly status: ExitRunStatus;
  readonly communityId: CommunityId;
}

export interface ExitEngine {
  insertRun(store: PaymentsStore, input: StartExitRun): Promise<ExitRunRecord>;
  dispatch(run: ExitRunRecord): Promise<void>;
  start(communityId: CommunityId, input: StartExitRun): Promise<ExitRunRecord>;
  run(payload: ExitRunJobPayload): Promise<ExitRunResult>;
}

type StepOutcome =
  | { readonly kind: "applied"; readonly endsAt: Date | null }
  | { readonly kind: "gone" }
  | { readonly kind: "failed" };

const finishHooks: Partial<Record<ExitKind, ExitKindHook>> = {
  archive: archiveFinished,
  disconnect: disconnectFinished,
  delete: deleteFinished,
};

interface PlannedStep {
  readonly step: SubscriptionStep;
  readonly targets: readonly ExitSubscription[];
}

function stepTargets(
  step: SubscriptionStep,
  subs: readonly ExitSubscription[],
  includeLinked: boolean,
): readonly ExitSubscription[] {
  if (step === "remove_fee") {
    return subs.filter((sub) => isExitEligible(sub.providerStatus) && sub.applicationFeeBps > 0);
  }
  return selectExitTargets(subs, includeLinked).targets;
}

function planSteps(
  kind: ExitKind,
  choice: ExitChoice,
  subs: readonly ExitSubscription[],
  includeLinked: boolean,
): readonly PlannedStep[] {
  const { leftRunning } = selectExitTargets(subs, includeLinked);
  return [
    ...stepsFor(kind, choice).map((step) => ({
      step,
      targets: stepTargets(step, subs, includeLinked),
    })),
    ...leftRunningSteps(kind).map((step) => ({
      step,
      targets: stepTargets(step, leftRunning, true),
    })),
  ];
}

function runTargets(
  kind: ExitKind,
  choice: ExitChoice,
  subs: readonly ExitSubscription[],
  includeLinked: boolean,
): Map<string, ExitSubscription> {
  const all = new Map<string, ExitSubscription>();
  for (const sub of selectExitTargets(subs, includeLinked).targets) {
    all.set(sub.id, sub);
  }
  for (const planned of planSteps(kind, choice, subs, includeLinked)) {
    for (const sub of planned.targets) {
      all.set(sub.id, sub);
    }
  }
  return all;
}

function inTargetState(step: SubscriptionStep, subscription: GatewaySubscription): boolean {
  switch (step) {
    case "remove_fee":
      return subscription.applicationFeePercent === null || subscription.applicationFeePercent <= 0;
    case "cancel_at_period_end":
      return subscription.cancelAtPeriodEnd;
    case "cancel_now":
      return subscription.status === "canceled";
  }
}

export function createExitEngine(runtime: Runtime): ExitEngine {
  const { repo } = runtime;

  function system<T>(communityId: CommunityId, fn: (store: PaymentsStore) => Promise<T>) {
    return repo.inCommunityAsSystem(communityId, fn);
  }

  async function insertRun(store: PaymentsStore, input: StartExitRun): Promise<ExitRunRecord> {
    const subs = await store.exit.listExitSubscriptions(input.connectionId);
    const targets = runTargets(input.kind, input.choice, subs, input.includeLinked);
    return store.exit.insertRun({
      id: runtime.newId(),
      kind: input.kind,
      choice: input.choice,
      connectionId: input.connectionId,
      includeLinked: input.includeLinked,
      requestedBy: input.requestedBy,
      portalLoginUrl: input.portalLoginUrl ?? null,
      manualCancellationConfirmedAt: input.manualCancellationConfirmedAt ?? null,
      targetCount: targets.size,
    });
  }

  async function runInline(payload: ExitRunJobPayload): Promise<void> {
    for (;;) {
      try {
        await run(payload);
        return;
      } catch (error: unknown) {
        if (!(error instanceof ExitRunIncompleteError)) {
          throw error;
        }
      }
    }
  }

  async function dispatch(record: ExitRunRecord): Promise<void> {
    const payload = { runId: record.id, communityId: record.communityId };
    if (runtime.jobs) {
      try {
        await runtime.jobs.scheduleExitRun(payload);
        return;
      } catch (error: unknown) {
        runtime.log({
          msg: "exit run job could not be scheduled, running inline",
          level: "warn",
          runId: record.id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    await runInline(payload);
  }

  async function start(communityId: CommunityId, input: StartExitRun): Promise<ExitRunRecord> {
    const record = await system(communityId, (store) => insertRun(store, input));
    await dispatch(record);
    return record;
  }

  function connectionLoader(): (connectionId: string) => Promise<ConnectionRecord | null> {
    const cache = new Map<string, Promise<ConnectionRecord | null>>();
    return (connectionId) => {
      let found = cache.get(connectionId);
      if (!found) {
        found = repo.findConnectionById(connectionId);
        cache.set(connectionId, found);
      }
      return found;
    };
  }

  async function applyStep(
    record: ExitRunRecord,
    step: SubscriptionStep,
    sub: ExitSubscription,
    connectionOf: (connectionId: string) => Promise<ConnectionRecord | null>,
  ): Promise<StepOutcome> {
    const communityId = communityIdSchema.parse(record.communityId);
    try {
      const connection = await connectionOf(sub.connectionId);
      if (!connection || connection.status === "disconnected") {
        return { kind: "failed" };
      }
      const { provider, conn } = providerFor(runtime, connection);
      const externalId = sub.externalSubscriptionId;
      const fetch = () => callStripe(runtime, () => provider.getSubscription(externalId, conn));
      const current = await fetch();
      if (!isExitEligible(current.status)) {
        return { kind: "gone" };
      }
      const setPlatformFee = provider.setPlatformFee?.bind(provider);
      if (step === "remove_fee" && !setPlatformFee) {
        return { kind: "applied", endsAt: current.currentPeriodEnd ?? sub.currentPeriodEnd };
      }
      let verified = current;
      if (!inTargetState(step, current)) {
        if (step === "remove_fee" && setPlatformFee) {
          await callStripe(runtime, () =>
            setPlatformFee(externalId, 0, `disconnect:${connection.id}:${externalId}`, conn),
          );
        } else {
          const atPeriodEnd = step === "cancel_at_period_end";
          const suffix = atPeriodEnd ? "period-end" : "cancel";
          await callStripe(runtime, () =>
            provider.cancelSubscription(
              externalId,
              { atPeriodEnd, idempotencyKey: `exit:${record.id}:${sub.id}:${suffix}` },
              conn,
            ),
          );
        }
        verified = await fetch();
        if (!inTargetState(step, verified)) {
          runtime.log({
            msg: "exit step did not take effect",
            level: "warn",
            runId: record.id,
            subscriptionId: sub.id,
            step,
          });
          return { kind: "failed" };
        }
      }
      await system(communityId, async (store) => {
        if (step === "remove_fee") {
          await store.setSubscriptionFeeBps(sub.id, 0);
        } else if (step === "cancel_at_period_end") {
          await store.exit.setCancelAtPeriodEnd(sub.id, true);
        }
      });
      return { kind: "applied", endsAt: verified.currentPeriodEnd ?? sub.currentPeriodEnd };
    } catch (error: unknown) {
      runtime.log({
        msg: "exit step failed for a subscription",
        level: "error",
        runId: record.id,
        subscriptionId: sub.id,
        step,
        error: error instanceof Error ? error.name : "unknown",
      });
      return { kind: "failed" };
    }
  }

  async function run(payload: ExitRunJobPayload): Promise<ExitRunResult> {
    const { runId, communityId: rawCommunityId } = parse(exitRunJobPayloadSchema, payload);
    const communityId = communityIdSchema.parse(rawCommunityId);
    const community = await repo.findCommunity(communityId);
    if (!community) {
      throw new PaymentsNotFoundError("community");
    }
    const claimed = await system(communityId, async (store) => {
      const found = await store.exit.findRun(runId);
      if (!found) {
        throw new PaymentsNotFoundError("exit_run");
      }
      if (found.status === "done" || found.status === "failed") {
        return { record: found, fresh: false };
      }
      const record = await store.exit.updateRun(runId, {
        status: "running",
        attempts: found.attempts + 1,
      });
      return { record, fresh: true };
    });
    const record = claimed.record;
    if (!claimed.fresh) {
      return { kind: record.kind, status: record.status, communityId };
    }

    const subs = await system(communityId, (store) =>
      store.exit.listExitSubscriptions(record.connectionId),
    );
    const selection = selectExitTargets(subs, record.includeLinked);
    const all = runTargets(record.kind, record.choice, subs, record.includeLinked);
    const connectionOf = connectionLoader();
    const failed = new Set<string>();
    const gone = new Set<string>();
    const endsAt = new Map<string, Date | null>();
    for (const { step, targets } of planSteps(
      record.kind,
      record.choice,
      subs,
      record.includeLinked,
    )) {
      for (const sub of targets) {
        if (failed.has(sub.id) || gone.has(sub.id)) {
          continue;
        }
        const outcome = await applyStep(record, step, sub, connectionOf);
        if (outcome.kind === "failed") {
          failed.add(sub.id);
        } else if (outcome.kind === "gone") {
          gone.add(sub.id);
        } else {
          endsAt.set(sub.id, outcome.endsAt);
        }
      }
      if (failed.size > 0) {
        break;
      }
    }

    const doneCount = all.size - failed.size;
    const failedSubscriptionIds = [...failed];
    const outcome = exitRunOutcome({ attempts: record.attempts, failed: failed.size });
    runtime.log({
      msg: "exit run attempt finished",
      level: failed.size > 0 ? "warn" : "info",
      runId: record.id,
      kind: record.kind,
      attempt: record.attempts,
      done: doneCount,
      failed: failed.size,
      outcome,
    });
    if (outcome === "retry") {
      await system(communityId, (store) =>
        store.exit.updateRun(record.id, { doneCount, failedSubscriptionIds }),
      );
      throw new ExitRunIncompleteError(record.id, failed.size);
    }

    const completed: ExitTargetResult[] = selection.targets
      .filter((sub) => !failed.has(sub.id) && !gone.has(sub.id))
      .map((sub) => ({
        subscription: sub,
        endsAt: endsAt.has(sub.id) ? (endsAt.get(sub.id) ?? null) : sub.currentPeriodEnd,
      }));
    const finished = await system(communityId, async (store) => {
      const updated = await store.exit.updateRun(record.id, {
        status: outcome,
        doneCount,
        failedSubscriptionIds,
        finishedAt: runtime.now(),
      });
      const actorId = record.requestedBy ?? (await store.findOwnerId());
      const hook = finishHooks[record.kind];
      if (hook && actorId) {
        await hook({
          run: updated,
          status: outcome,
          community,
          actorId,
          completed,
          leftRunning: selection.leftRunning,
          store,
          now: runtime.now(),
        });
      }
      return updated;
    });
    if (finished.kind === "delete" && finished.status === "failed") {
      await applyDeferredRemovals(communityId, finished.createdAt);
    }
    return { kind: finished.kind, status: finished.status, communityId };
  }

  async function applyDeferredRemovals(communityId: CommunityId, since: Date): Promise<void> {
    const removable = await system(communityId, async (store) => {
      const userIds: string[] = [];
      for (const userId of await store.exit.listDeferredRemovals(since)) {
        const member = await store.findMember(userId);
        if (member?.status !== "active" || member.role !== "member") {
          continue;
        }
        if (compGrants(await store.comps.findOpen(userId), runtime.now())) {
          continue;
        }
        userIds.push(userId);
      }
      return userIds;
    });
    for (const userId of removable) {
      await repo.removeMembership(communityId, userId);
    }
    if (removable.length > 0) {
      runtime.log({
        msg: "deferred membership removals applied after a failed delete run",
        level: "info",
        communityId,
        removed: removable.length,
      });
    }
  }

  return { insertRun, dispatch, start, run };
}
