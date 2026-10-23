import { describe, expect, it } from "vitest";

import { InvalidExitChoiceError } from "../errors";
import {
  exitRunMaxAttempts,
  exitRunOutcome,
  isExitEligible,
  leftRunningSteps,
  selectExitTargets,
  stepsFor,
} from "./rules";
import type { ExitSubscription } from "./store";

function subscription(overrides: Partial<ExitSubscription> = {}): ExitSubscription {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    userId: "01900000-0000-7000-8000-000000000002",
    connectionId: "01900000-0000-7000-8000-000000000003",
    externalSubscriptionId: "sub_1",
    origin: "created_by_cohory",
    providerStatus: "active",
    currentPeriodEnd: new Date("2026-11-18T10:00:00.000Z"),
    cancelAtPeriodEnd: false,
    applicationFeeBps: 200,
    ...overrides,
  };
}

describe("isExitEligible", () => {
  it("treats active, trialing, past_due, and unpaid as eligible and canceled or incomplete as not", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid"]) {
      expect(isExitEligible(status)).toBe(true);
    }
    for (const status of ["canceled", "incomplete", "incomplete_expired", "paused", ""]) {
      expect(isExitEligible(status)).toBe(false);
    }
  });
});

describe("selectExitTargets", () => {
  const cohory = subscription({ id: "a", origin: "created_by_cohory" });
  const linked = subscription({ id: "b", origin: "linked_import" });

  it("targets linked imports by default", () => {
    expect(selectExitTargets([cohory, linked], true)).toEqual({
      targets: [cohory, linked],
      leftRunning: [],
    });
  });

  it("moves linked imports to leftRunning when includeLinked is false", () => {
    expect(selectExitTargets([cohory, linked], false)).toEqual({
      targets: [cohory],
      leftRunning: [linked],
    });
  });

  it("never targets a subscription that is no longer eligible", () => {
    const canceled = subscription({ id: "c", providerStatus: "canceled" });
    expect(selectExitTargets([cohory, canceled], true).targets).toEqual([cohory]);
  });
});

describe("stepsFor", () => {
  it("sets subscriptions to end at the period end on an archive with stop at period end", () => {
    expect(stepsFor("archive", "stop_at_period_end")).toEqual(["cancel_at_period_end"]);
  });

  it("touches no subscription on an archive with keep billing", () => {
    expect(stepsFor("archive", "keep_billing")).toEqual([]);
  });

  it("only removes the fee when the owner takes members along", () => {
    expect(stepsFor("disconnect", "take_members")).toEqual(["remove_fee"]);
  });

  it("removes the fee before winding down", () => {
    expect(stepsFor("disconnect", "wind_down")).toEqual(["remove_fee", "cancel_at_period_end"]);
  });

  it("cancels now on a delete", () => {
    expect(stepsFor("delete", "cancel_now")).toEqual(["cancel_now"]);
  });

  it("removes the fee from linked imports a delete leaves running", () => {
    expect(leftRunningSteps("delete")).toEqual(["remove_fee"]);
    expect(leftRunningSteps("archive")).toEqual([]);
    expect(leftRunningSteps("disconnect")).toEqual([]);
  });

  it("rejects keep_billing on a delete", () => {
    expect(() => stepsFor("delete", "keep_billing")).toThrow(InvalidExitChoiceError);
  });

  it("rejects a choice that belongs to another exit", () => {
    expect(() => stepsFor("archive", "take_members")).toThrow(InvalidExitChoiceError);
    expect(() => stepsFor("disconnect", "cancel_now")).toThrow(InvalidExitChoiceError);
  });
});

describe("exitRunOutcome", () => {
  it("retries until the eighth attempt, then fails", () => {
    expect(exitRunMaxAttempts).toBe(8);
    expect(exitRunOutcome({ attempts: 7, failed: 1 })).toBe("retry");
    expect(exitRunOutcome({ attempts: 8, failed: 1 })).toBe("failed");
    expect(exitRunOutcome({ attempts: 1, failed: 0 })).toBe("done");
  });

  it("finishes on the last attempt when nothing failed", () => {
    expect(exitRunOutcome({ attempts: 8, failed: 0 })).toBe("done");
  });
});
