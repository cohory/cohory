import type { ApprovalsService, ApprovalView } from "@cohory/agents/approvals";
import { newId } from "@cohory/db";
import { vi, type Mock } from "vitest";

export type ApprovalsStub = { [K in keyof ApprovalsService]: Mock<ApprovalsService[K]> };

export function createApprovalsStub(): ApprovalsStub {
  return {
    propose: vi.fn<ApprovalsService["propose"]>(),
    list: vi.fn<ApprovalsService["list"]>(),
    pendingCount: vi.fn<ApprovalsService["pendingCount"]>(),
    listForActor: vi.fn<ApprovalsService["listForActor"]>(),
    get: vi.fn<ApprovalsService["get"]>(),
    claim: vi.fn<ApprovalsService["claim"]>(),
    finish: vi.fn<ApprovalsService["finish"]>(),
    reject: vi.fn<ApprovalsService["reject"]>(),
    claimDownload: vi.fn<ApprovalsService["claimDownload"]>(),
    releaseDownload: vi.fn<ApprovalsService["releaseDownload"]>(),
    expireDue: vi.fn<ApprovalsService["expireDue"]>(),
    listPurchaseRequests: vi.fn<ApprovalsService["listPurchaseRequests"]>(),
    claimPurchase: vi.fn<ApprovalsService["claimPurchase"]>(),
    rejectPurchase: vi.fn<ApprovalsService["rejectPurchase"]>(),
  };
}

export function approvalView(overrides: Partial<ApprovalView> = {}): ApprovalView {
  const createdAt = new Date("2026-10-19T10:00:00.000Z");
  return {
    id: newId(),
    communityId: newId(),
    state: "pending",
    operationId: "removeMember",
    method: "POST",
    path: "/api/v1/communities/x/manage/people/y/remove",
    category: "removal",
    summary: "remove a member",
    diff: [],
    agent: { id: newId(), name: "Helper", status: "active" },
    owner: { id: newId(), name: "Owner" },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    executedAt: null,
    errorCode: null,
    result: null,
    download: null,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 72 * 60 * 60 * 1000),
    ...overrides,
  };
}
