import { InvalidExitChoiceError } from "../errors";
import {
  exitEligibleStatuses,
  type ExitChoice,
  type ExitKind,
  type ExitSubscription,
} from "./store";

export { exitEligibleStatuses };

export const exitRunMaxAttempts = 8;

export type SubscriptionStep = "remove_fee" | "cancel_at_period_end" | "cancel_now";

export type ExitRunOutcome = "done" | "retry" | "failed";

const eligible: ReadonlySet<string> = new Set(exitEligibleStatuses);

const stepTable: Readonly<
  Record<ExitKind, Partial<Readonly<Record<ExitChoice, readonly SubscriptionStep[]>>>>
> = {
  archive: { stop_at_period_end: ["cancel_at_period_end"], keep_billing: [] },
  disconnect: { take_members: ["remove_fee"], wind_down: ["remove_fee", "cancel_at_period_end"] },
  delete: { cancel_now: ["cancel_now"] },
};

const leftRunningStepTable: Readonly<Record<ExitKind, readonly SubscriptionStep[]>> = {
  archive: [],
  disconnect: [],
  delete: ["remove_fee"],
};

export function leftRunningSteps(kind: ExitKind): readonly SubscriptionStep[] {
  return leftRunningStepTable[kind];
}

export function isExitEligible(providerStatus: string): boolean {
  return eligible.has(providerStatus);
}

export function selectExitTargets(
  subs: readonly ExitSubscription[],
  includeLinked: boolean,
): {
  readonly targets: readonly ExitSubscription[];
  readonly leftRunning: readonly ExitSubscription[];
} {
  const targets: ExitSubscription[] = [];
  const leftRunning: ExitSubscription[] = [];
  for (const sub of subs) {
    if (!isExitEligible(sub.providerStatus)) {
      continue;
    }
    if (sub.origin === "linked_import" && !includeLinked) {
      leftRunning.push(sub);
      continue;
    }
    targets.push(sub);
  }
  return { targets, leftRunning };
}

export function stepsFor(kind: ExitKind, choice: ExitChoice): readonly SubscriptionStep[] {
  const steps = stepTable[kind][choice];
  if (!steps) {
    throw new InvalidExitChoiceError(kind, choice);
  }
  return steps;
}

export function exitRunOutcome(input: {
  readonly attempts: number;
  readonly failed: number;
}): ExitRunOutcome {
  if (input.failed === 0) {
    return "done";
  }
  return input.attempts >= exitRunMaxAttempts ? "failed" : "retry";
}
