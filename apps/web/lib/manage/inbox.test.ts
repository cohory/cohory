import type { Actor } from "@cohory/authz";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inboxTabsFor, inboxTotal, loadInboxCounts, openInboxTab } from "./inbox";

const services = vi.hoisted(() => ({
  countJoinRequests: vi.fn<(actor: unknown, communityId: string) => Promise<number>>(),
  countOpenReports: vi.fn<(actor: unknown, communityId: string) => Promise<number>>(),
  countOpenReviewReports: vi.fn<(actor: unknown, communityId: string) => Promise<number>>(),
  pendingCount: vi.fn<(actor: unknown, communityId: string) => Promise<number>>(),
}));

vi.mock("react", () => ({ cache: <T>(fn: T): T => fn }));
vi.mock("@cohory/communities", () => ({
  getManageService: () => ({ countJoinRequests: services.countJoinRequests }),
}));
vi.mock("@cohory/api/services", () => ({
  getPostsService: () => ({ countOpenReports: services.countOpenReports }),
}));
vi.mock("@cohory/reviews", () => ({
  getReviewsService: () => ({ countOpenReviewReports: services.countOpenReviewReports }),
}));
vi.mock("@cohory/agents/approvals", () => ({
  getApprovalsService: () => ({ pendingCount: services.pendingCount }),
}));

const actor: Actor = {
  kind: "user",
  userId: "0199e7a0-0000-7000-8000-000000000001",
  platformAdmin: false,
};

describe("inboxTabsFor", () => {
  it("gives owners and admins requests, reports, and agent approvals", () => {
    expect(inboxTabsFor({ actor, role: "owner" })).toEqual(["requests", "reports", "approvals"]);
    expect(inboxTabsFor({ actor, role: "admin" })).toEqual(["requests", "reports", "approvals"]);
  });

  it("gives moderators requests and reports, never agent approvals", () => {
    expect(inboxTabsFor({ actor, role: "moderator" })).toEqual(["requests", "reports"]);
  });

  it("gives members nothing", () => {
    expect(inboxTabsFor({ actor, role: "member" })).toEqual([]);
  });
});

describe("openInboxTab", () => {
  const tabs = ["requests", "reports", "approvals"] as const;

  it("opens the tab the URL names when the viewer has it", () => {
    expect(openInboxTab(tabs, {}, "approvals")).toBe("approvals");
    expect(openInboxTab(["requests", "reports"], {}, "approvals")).toBe("requests");
  });

  it("otherwise opens the first tab with something waiting", () => {
    expect(openInboxTab(tabs, { requests: 0, reports: 2, approvals: 1 }, undefined)).toBe(
      "reports",
    );
    expect(openInboxTab(tabs, { requests: 0, reports: 0, approvals: 0 }, "nonsense")).toBe(
      "requests",
    );
  });

  it("opens nothing for a viewer without tabs", () => {
    expect(openInboxTab([], {}, "requests")).toBeNull();
  });
});

describe("inboxTotal", () => {
  it("adds every waiting item", () => {
    expect(inboxTotal({ requests: 3, reports: 1, approvals: 2 })).toBe(6);
    expect(inboxTotal({})).toBe(0);
  });
});

describe("loadInboxCounts", () => {
  const communityId = "0199e7a0-0000-7000-8000-0000000000c1";
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    services.countJoinRequests.mockResolvedValue(2);
    services.countOpenReports.mockResolvedValue(3);
    services.countOpenReviewReports.mockResolvedValue(1);
    services.pendingCount.mockResolvedValue(4);
    warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    warn.mockRestore();
  });

  it("counts each tab with the cheap count queries", async () => {
    await expect(loadInboxCounts(actor, "owner", communityId)).resolves.toEqual({
      requests: 2,
      reports: 4,
      approvals: 4,
    });
    expect(services.countJoinRequests).toHaveBeenCalledWith(actor, communityId);
  });

  it("skips the counts of tabs the viewer does not have", async () => {
    await expect(loadInboxCounts(actor, "moderator", communityId)).resolves.toEqual({
      requests: 2,
      reports: 4,
    });
    expect(services.pendingCount).not.toHaveBeenCalled();
  });

  it("leaves out a count that fails and logs it without failing the others", async () => {
    services.countOpenReviewReports.mockRejectedValue(new TypeError("connection reset"));

    await expect(loadInboxCounts(actor, "owner", communityId)).resolves.toEqual({
      requests: 2,
      approvals: 4,
    });
    const line: unknown = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "warn",
      msg: "Could not count the Inbox tab",
      tab: "reports",
      reason: "TypeError",
    });
  });
});
