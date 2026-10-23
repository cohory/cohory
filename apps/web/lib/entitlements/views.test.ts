import { describe, expect, it } from "vitest";

import { delegationItem, delegationStatus, submissionItem } from "./views";

describe("delegationStatus", () => {
  it.each([
    [{ kind: "active" } as const, "Active"],
    [
      { kind: "paused", reason: "human_access_ended" } as const,
      "Paused: you no longer have access to this course",
    ],
    [{ kind: "ended", reason: "revoked" } as const, "Revoked"],
    [{ kind: "ended", reason: "expired" } as const, "Expired"],
  ])("labels %o as %s", (state, label) => {
    expect(delegationStatus(state)).toBe(label);
  });
});

describe("delegationItem", () => {
  it("marks revoked delegations as not live", () => {
    const item = delegationItem({
      id: "d",
      courseId: "c",
      humanId: "h",
      agent: { id: "a", name: "Helper" },
      grantedAt: new Date("2026-10-01T00:00:00Z"),
      expiresAt: new Date("2026-10-31T00:00:00Z"),
      renewedAt: null,
      revokedAt: new Date("2026-10-02T00:00:00Z"),
      state: { kind: "ended", reason: "revoked" },
    });
    expect(item).toMatchObject({ live: false, active: false, agentName: "Helper" });
  });
});

describe("submissionItem", () => {
  it("shortens long payloads for display", () => {
    const item = submissionItem({
      id: "s",
      courseId: "c",
      lessonId: "l",
      taskId: "t",
      version: "1",
      runId: "r",
      label: "self_reported",
      agent: { id: "a", name: "Helper" },
      humanId: "h",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      payload: { text: "x".repeat(1000) },
    });
    expect(item.payload.length).toBe(400);
    expect(item.payload.endsWith("…")).toBe(true);
  });
});
