import { describe, expect, it } from "vitest";

import {
  agentForbiddenActions,
  approvalActions,
  approvalCategories,
  credentialDecision,
  nonGrantableActions,
  proposalScope,
  roleMayPerform,
  type ApprovalCategory,
} from "./credentials";
import { AgentNotAllowedError, ApprovalRequiredError, ForbiddenError } from "./errors";
import { matrix, type Resource } from "./matrix";
import { assertCan, can } from "./policy";
import type { Actor, ApiCredential, PolicyAction } from "./types";

const userId = "0192f0a0-0000-7000-8000-000000000001";
const communityId = "0192f0a0-0000-7000-8000-0000000000c1";

function credential(type: ApiCredential["type"]): ApiCredential {
  return {
    type,
    tokenId: "0192f0a0-0000-7000-8000-0000000000t1",
    agentId: type === "agent" ? "0192f0a0-0000-7000-8000-0000000000a1" : null,
    communityId,
    scopes: ["posts:write"],
    via: "api",
  };
}

function actor(type?: ApiCredential["type"]): Actor {
  return type
    ? { kind: "user", userId, platformAdmin: false, credential: credential(type) }
    : { kind: "user", userId, platformAdmin: false };
}

const everyAction: PolicyAction[] = (Object.keys(matrix) as Resource[]).flatMap((resource) =>
  Object.keys(matrix[resource]).map((action) => `${resource}.${action}` as PolicyAction),
);

const expectedByCategory: Record<ApprovalCategory, PolicyAction[]> = {
  money: [
    "payment.refund",
    "payment.edit_plan",
    "payment.link_subscriptions",
    "membership.grant_comp",
  ],
  payment_connection: ["payment.connect"],
  role: ["membership.change_role", "membership.assign_admin"],
  removal: ["membership.remove", "membership.ban"],
  deletion: ["post.delete", "comment.delete", "course.delete", "lesson.delete", "event.delete"],
  data_export: [
    "export.create",
    "export.members",
    "migration.export",
    "audit_log.export",
    "webhook.manage",
  ],
  data_import: ["migration.import", "migration.import_members"],
  settings: ["settings.custom_domain", "settings.update", "appearance.update"],
  publishing: [
    "course.publish",
    "course.publish_agent_version",
    "lesson.publish",
    "post.email_all",
  ],
  purchase: ["payment.purchase"],
};

const credentialActions: PolicyAction[] = [
  "api_token.create_own",
  "api_token.read_all",
  "api_token.manage_all",
  "agent.read",
  "agent.create",
  "agent.create_own",
  "agent.manage",
  "approval.read",
  "approval.decide",
  "course.manage_agent_access",
  "delegation.create",
  "delegation.manage",
  "delegation.read_all",
];

const reviewWriteActions: PolicyAction[] = [
  "review.create",
  "review.edit",
  "review.delete",
  "review.report",
  "review.reply",
  "review.hide",
];

describe("approval classification", () => {
  it("names every category once", () => {
    expect(Object.keys(expectedByCategory).sort()).toEqual([...approvalCategories].sort());
  });

  for (const category of approvalCategories) {
    it.each(expectedByCategory[category])(`classifies %s as ${category}`, (action) => {
      expect(approvalActions[action]).toBe(category);
    });
  }

  it("classifies nothing else", () => {
    const classified = Object.keys(approvalActions).sort();
    expect(classified).toEqual(Object.values(expectedByCategory).flat().sort());
  });

  it("only classifies actions that exist in the matrix", () => {
    for (const action of Object.keys(approvalActions)) {
      expect(everyAction).toContain(action);
    }
  });

  it("keeps every non grantable action in the approval list except credentials and agent refusals", () => {
    for (const action of nonGrantableActions) {
      if (
        credentialActions.includes(action) ||
        reviewWriteActions.includes(action) ||
        agentForbiddenActions.has(action)
      ) {
        expect(approvalActions[action]).toBeUndefined();
      } else {
        expect(approvalActions[action]).toBeDefined();
      }
    }
  });
});

describe("credentialDecision", () => {
  it.each(reviewWriteActions)("refuses %s to every token, personal or agent", (action) => {
    expect(credentialDecision(credential("user"), action)).toEqual({ kind: "not_grantable" });
    expect(credentialDecision(credential("agent"), action)).toEqual({ kind: "not_grantable" });
  });

  it("lets a token read reviews", () => {
    expect(credentialDecision(credential("agent"), "review.read")).toEqual({ kind: "allowed" });
  });

  it("lets an agent create a post", () => {
    expect(credentialDecision(credential("agent"), "post.create")).toEqual({ kind: "allowed" });
  });

  it.each(Object.entries(approvalActions) as [PolicyAction, ApprovalCategory][])(
    "asks for approval when an agent tries %s",
    (action, category) => {
      expect(credentialDecision(credential("agent"), action)).toEqual({
        kind: "approval_required",
        category,
      });
    },
  );

  it.each([...agentForbiddenActions])("never lets an agent propose %s", (action) => {
    expect(approvalActions[action]).toBeUndefined();
    expect(credentialDecision(credential("agent"), action)).toEqual({
      kind: "not_allowed_for_agents",
    });
  });

  it("refuses archiving, deleting, transferring, renaming the community URL, and answering creator questions to agents", () => {
    expect([...agentForbiddenActions].sort()).toEqual([
      "community.archive",
      "community.change_slug",
      "community.delete",
      "community.transfer_ownership",
      "creator_feedback.answer",
    ]);
    expect(credentialDecision(credential("user"), "community.archive")).toEqual({
      kind: "allowed",
    });
  });

  it.each([...nonGrantableActions])("refuses %s to a personal token", (action) => {
    expect(credentialDecision(credential("user"), action)).toEqual({ kind: "not_grantable" });
  });

  it.each(credentialActions)("never lets any token reach %s", (action) => {
    expect(credentialDecision(credential("agent"), action)).toEqual({ kind: "not_grantable" });
    expect(credentialDecision(credential("user"), action)).toEqual({ kind: "not_grantable" });
  });

  it("lets a personal token export members when it holds members:export and the role allows", () => {
    expect(credentialDecision(credential("user"), "export.members")).toEqual({ kind: "allowed" });
    expect(credentialDecision(credential("agent"), "export.members")).toEqual({
      kind: "approval_required",
      category: "data_export",
    });
  });

  it("lets a personal token remove a member when the role allows it", () => {
    expect(credentialDecision(credential("user"), "membership.remove")).toEqual({
      kind: "allowed",
    });
  });
});

describe("policy with credentials", () => {
  const owner = { role: "owner", target: { role: "member", isSelf: false } } as const;

  it("keeps session callers unchanged", () => {
    expect(can(actor(), "remove", "membership", owner)).toBe(true);
  });

  it("denies an agent a removal even when the owner may remove", () => {
    expect(can(actor("agent"), "remove", "membership", owner)).toBe(false);
    expect(() => assertCan(actor("agent"), "remove", "membership", owner)).toThrow(
      ApprovalRequiredError,
    );
    expect(() => assertCan(actor("agent"), "remove", "membership", owner)).toThrow(
      expect.objectContaining({ code: "approval_required", category: "removal" }),
    );
  });

  it("refuses an owner's agent archive, delete, and ownership transfer with a stable code", () => {
    for (const action of ["archive", "delete", "transfer_ownership", "change_slug"] as const) {
      expect(can(actor("agent"), action, "community", { role: "owner" })).toBe(false);
      expect(() => assertCan(actor("agent"), action, "community", { role: "owner" })).toThrow(
        AgentNotAllowedError,
      );
      expect(() => assertCan(actor("agent"), action, "community", { role: "owner" })).toThrow(
        expect.objectContaining({ code: "not_allowed_for_agents" }),
      );
    }
    expect(() => assertCan(actor(), "archive", "community", { role: "owner" })).not.toThrow();
  });

  it("keeps the community URL change session only", () => {
    expect(credentialDecision(credential("user"), "community.change_slug")).toEqual({
      kind: "not_grantable",
    });
    expect(() => assertCan(actor("user"), "change_slug", "community", { role: "owner" })).toThrow(
      ForbiddenError,
    );
    expect(() => assertCan(actor(), "change_slug", "community", { role: "owner" })).not.toThrow();
  });

  it("denies a personal token a non grantable action with forbidden", () => {
    expect(() => assertCan(actor("user"), "refund", "payment", { role: "owner" })).toThrow(
      ForbiddenError,
    );
  });

  it("still applies the role: an agent of a member cannot pin", () => {
    expect(can(actor("agent"), "pin", "post", { role: "member" })).toBe(false);
    expect(() => assertCan(actor("agent"), "pin", "post", { role: "member" })).toThrow(
      ForbiddenError,
    );
  });

  it("lets an agent of an admin pin", () => {
    expect(can(actor("agent"), "pin", "post", { role: "admin" })).toBe(true);
  });

  it("does not ask for approval when the role would refuse anyway", () => {
    expect(() =>
      assertCan(actor("agent"), "remove", "membership", {
        role: "member",
        target: { role: "member", isSelf: false },
      }),
    ).toThrow(ForbiddenError);
  });
});

describe("roleMayPerform", () => {
  it("is true when the role has any rule other than deny for the action", () => {
    expect(roleMayPerform("admin", "membership.remove")).toBe(true);
    expect(roleMayPerform("owner", "export.members")).toBe(true);
    expect(roleMayPerform("moderator", "membership.remove")).toBe(true);
  });

  it("is false when the role is denied or missing", () => {
    expect(roleMayPerform("admin", "export.members")).toBe(false);
    expect(roleMayPerform("member", "membership.remove")).toBe(false);
    expect(roleMayPerform(null, "membership.remove")).toBe(false);
  });
});

describe("proposalScope", () => {
  it("keeps the route scope when the route has one", () => {
    expect(proposalScope("membership.remove", "members:moderate")).toBe("members:moderate");
  });

  it("asks for the area's scope when the route is for signed in people only", () => {
    expect(proposalScope("settings.update", null)).toBe("settings:read");
    expect(proposalScope("appearance.update", null)).toBe("settings:read");
    expect(proposalScope("payment.edit_plan", null)).toBe("payments:read");
    expect(proposalScope("membership.grant_comp", null)).toBe("payments:read");
    expect(proposalScope("community.delete", null)).toBeNull();
    expect(proposalScope("community.transfer_ownership", null)).toBeNull();
  });

  it("gives every approval action a scope", () => {
    for (const action of Object.keys(approvalActions) as PolicyAction[]) {
      expect(proposalScope(action, null)).not.toBeNull();
    }
  });

  it("is null for actions that never need approval", () => {
    expect(proposalScope("post.read", null)).toBeNull();
  });
});
