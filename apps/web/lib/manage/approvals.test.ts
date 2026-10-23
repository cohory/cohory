import type { ApprovalView } from "@cohory/agents/approvals";
import { describe, expect, it } from "vitest";

import { approvalOutcome, toApprovalRow } from "./approvals";

const createdAt = new Date("2026-10-19T10:00:00.000Z");

function view(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "0192f0a0-0000-7000-8000-000000000001",
    communityId: "0192f0a0-0000-7000-8000-000000000002",
    state: "pending",
    operationId: "removeMember",
    method: "POST",
    path: "/api/v1/communities/x/manage/people/y/remove",
    category: "removal",
    summary: "remove Sam Lee from the community",
    diff: [{ label: "Membership", before: "Member", after: "Removed" }],
    agent: { id: "a", name: "Helper", status: "active" },
    owner: { id: "o", name: "Ada" },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    executedAt: null,
    errorCode: null,
    result: null,
    download: null,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 72 * 3600 * 1000),
    ...overrides,
  };
}

describe("approval rows", () => {
  it("starts the summary with a capital letter and keeps the diff", () => {
    const row = toApprovalRow(view(), true);
    expect(row.summary).toBe("Remove Sam Lee from the community");
    expect(row.diff).toEqual([{ label: "Membership", before: "Member", after: "Removed" }]);
    expect(row.agentActive).toBe(true);
  });

  it("marks removals as serious and publishing as routine, with a category label", () => {
    expect(toApprovalRow(view(), true)).toMatchObject({
      agentId: "a",
      riskLabel: "People",
      serious: true,
    });
    expect(toApprovalRow(view({ category: "publishing" }), true)).toMatchObject({
      riskLabel: "Publish",
      serious: false,
    });
  });

  it("explains each outcome in plain language", () => {
    const owner = { id: "p", name: "Olive" };
    expect(approvalOutcome(view({ state: "executed", decidedBy: owner }))).toBe(
      "Approved by Olive and done.",
    );
    expect(
      approvalOutcome(
        view({
          state: "failed",
          decidedBy: owner,
          result: { error: { code: "not_supported", message: "Do it yourself in cohory." } },
        }),
      ),
    ).toBe("Approved by Olive, but it could not run. Do it yourself in cohory.");
    expect(
      approvalOutcome(view({ state: "rejected", decidedBy: owner, decisionNote: "Not now" })),
    ).toBe("Rejected by Olive. Note: Not now");
    expect(approvalOutcome(view({ state: "expired" }))).toBe(
      "Nobody decided within 72 hours, so it expired.",
    );
  });
});
