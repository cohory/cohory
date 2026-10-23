import type { AuditEntryView } from "@cohory/communities";
import { describe, expect, it } from "vitest";

import {
  auditActionLabel,
  auditDetails,
  auditFiltersFrom,
  auditQuery,
  auditTarget,
  auditWho,
} from "./audit";

const ownerId = "0192a7c0-0000-7000-8000-000000000001";
const agentId = "0192a7c0-0000-7000-8000-000000000002";
const approvalId = "0192a7c0-0000-7000-8000-000000000003";

function entry(overrides: Partial<AuditEntryView>): AuditEntryView {
  return {
    id: "0192a7c0-0000-7000-8000-000000000009",
    createdAt: new Date("2026-10-20T10:00:00Z"),
    actor: { id: ownerId, name: "Rev Creator" },
    actorType: "user",
    via: "web",
    tokenId: null,
    agent: null,
    action: "settings.updated",
    target: null,
    targetName: null,
    metadata: null,
    ...overrides,
  };
}

describe("auditWho", () => {
  it("names the person who approved an agent's request as the actor", () => {
    expect(
      auditWho(entry({ action: "approval.approved", agent: { id: agentId, name: "Ops helper" } })),
    ).toEqual({ kind: "decision", person: "Rev Creator", verb: "approved", agent: "Ops helper" });
  });

  it("names the person who rejected an agent's request as the actor", () => {
    expect(
      auditWho(entry({ action: "approval.rejected", agent: { id: agentId, name: "Ops helper" } })),
    ).toMatchObject({ kind: "decision", person: "Rev Creator", verb: "rejected" });
  });

  it("names the person who ran an agent's request without calling it a decision", () => {
    expect(
      auditWho(entry({ action: "member.removed", agent: { id: agentId, name: "Ops helper" } })),
    ).toEqual({ kind: "on_request", person: "Rev Creator", agent: "Ops helper" });
    expect(
      auditWho(entry({ action: "approval.executed", agent: { id: agentId, name: "Ops helper" } })),
    ).toMatchObject({ kind: "on_request" });
  });

  it("takes the decision from the action key, not from who acted", () => {
    expect(
      auditWho(
        entry({
          actorType: "agent",
          action: "approval.rejected",
          agent: { id: agentId, name: "Ops helper" },
        }),
      ),
    ).toMatchObject({ kind: "decision", verb: "rejected" });
  });

  it("shows the agent and its owner when the agent acted itself", () => {
    expect(
      auditWho(
        entry({
          actorType: "agent",
          via: "api",
          action: "approval.requested",
          agent: { id: agentId, name: "Ops helper" },
        }),
      ),
    ).toEqual({ kind: "agent", agent: "Ops helper", owner: "Rev Creator" });
  });

  it("shows people and the system plainly", () => {
    expect(auditWho(entry({}))).toEqual({ kind: "person", name: "Rev Creator" });
    expect(auditWho(entry({ actor: null, actorType: "system" }))).toEqual({ kind: "system" });
  });
});

describe("auditActionLabel", () => {
  it.each([
    ["agent.created", "Agent created"],
    ["member.role_changed", "Member role changed"],
    ["approval.approved", "Request approved"],
    ["approval.requested", "Approval requested"],
    ["api.create_post", "Create post (API)"],
    ["comp.expired", "Comped access expired"],
  ])("reads %s as %s", (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });
});

describe("auditTarget", () => {
  it("links a person to their member page", () => {
    expect(auditTarget(entry({ target: ownerId, targetName: "Sam Lee" }), "makers")).toEqual({
      label: "Sam Lee",
      href: `/c/makers/manage/people?member=${ownerId}`,
    });
  });

  it("links an approval to the inbox history with its summary", () => {
    expect(
      auditTarget(
        entry({
          action: "approval.approved",
          target: approvalId,
          metadata: { summary: "remove Sam Lee from the community" },
        }),
        "makers",
      ),
    ).toEqual({
      label: "Remove Sam Lee from the community",
      href: "/c/makers/manage/inbox?tab=approvals&view=history",
    });
  });

  it("keeps dots and underscores in approval summaries", () => {
    const label = (summary: string) =>
      auditTarget(entry({ action: "approval.approved", metadata: { summary } }), "makers").label;
    expect(label("set the membership price to $12.50 a month")).toBe(
      "Set the membership price to $12.50 a month",
    );
    expect(label("publish version 1.2.0 of my_course")).toBe("Publish version 1.2.0 of my_course");
  });

  it("hides raw API paths and ids", () => {
    expect(auditTarget(entry({ target: "/api/v1/communities/makers/posts" }), "makers")).toEqual({
      label: "API request",
      href: null,
    });
    expect(auditTarget(entry({ target: approvalId }), "makers")).toEqual({
      label: "Item",
      href: null,
    });
    expect(auditTarget(entry({ target: null }), "makers")).toEqual({ label: "None", href: null });
  });
});

describe("auditDetails", () => {
  it("lists every field with a readable label and full value", () => {
    expect(auditDetails(null)).toEqual([]);
    expect(
      auditDetails({
        role: "admin",
        count: 2,
        note: true,
        before: { a: 1 },
        text: "x".repeat(300),
      }),
    ).toEqual([
      { label: "Role", value: "admin" },
      { label: "Count", value: "2" },
      { label: "Note", value: "Yes" },
      { label: "Before", value: '{\n  "a": 1\n}' },
      { label: "Text", value: "x".repeat(300) },
    ]);
  });
});

describe("audit filters", () => {
  it("reads filters from search params and drops blanks", () => {
    expect(
      auditFiltersFrom({ action: "member.banned", from: "", to: ["2026-10-18"], other: "x" }),
    ).toEqual({ action: "member.banned", to: "2026-10-18" });
  });

  it("keeps agent and token filters only when they are ids", () => {
    expect(auditFiltersFrom({ agentId, tokenId: "nope" })).toEqual({ agentId });
  });

  it("builds a query string with extra params", () => {
    expect(auditQuery({ action: "a.b" }, { cursor: "abc" })).toBe("?action=a.b&cursor=abc");
    expect(auditQuery({})).toBe("");
  });
});
