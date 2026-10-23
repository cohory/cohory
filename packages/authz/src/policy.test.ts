import { describe, expect, it } from "vitest";

import { ForbiddenError } from "./errors";
import { matrix, resources, roles, type ActionOf, type Resource, type RoleRules } from "./matrix";
import { assertCan, can } from "./policy";
import type { Actor, CommunityRole, PolicyContext } from "./types";

type Persona =
  "signed_out" | "signed_in_guest" | "member" | "moderator" | "admin" | "owner" | "platform_admin";

const userId = "0192f0a0-0000-7000-8000-000000000001";

function persona(name: Persona): { actor: Actor; role: CommunityRole | null } {
  switch (name) {
    case "signed_out":
      return { actor: { kind: "guest" }, role: null };
    case "signed_in_guest":
      return { actor: { kind: "user", userId, platformAdmin: false }, role: null };
    case "platform_admin":
      return { actor: { kind: "user", userId, platformAdmin: true }, role: null };
    default:
      return { actor: { kind: "user", userId, platformAdmin: false }, role: name };
  }
}

const everyone: Persona[] = [
  "signed_out",
  "signed_in_guest",
  "member",
  "moderator",
  "admin",
  "owner",
  "platform_admin",
];

type Case = readonly [Persona, Omit<PolicyContext, "role">, boolean];

function allowOnly(allowed: Persona[], context: Omit<PolicyContext, "role"> = {}): Case[] {
  return everyone.map((p) => [p, context, allowed.includes(p)] as const);
}

const pub = { communityPrivacy: "public" } as const;
const priv = { communityPrivacy: "private" } as const;
const signedIn: Persona[] = everyone.filter((p) => p !== "signed_out");
const members: Persona[] = ["member", "moderator", "admin", "owner"];

function target(role: CommunityRole, isSelf = false): Omit<PolicyContext, "role"> {
  return { target: { role, isSelf } };
}

const communityCases: Record<ActionOf<"community">, Case[]> = {
  create: allowOnly(signedIn),
  read: [
    ...allowOnly([...signedIn, "signed_out"], pub),
    ...allowOnly([...members, "platform_admin"], priv),
  ],
  update: allowOnly(["admin", "owner"]),
  delete: allowOnly(["owner"]),
  transfer_ownership: allowOnly(["owner"]),
  archive: allowOnly(["owner"]),
  change_slug: allowOnly(["owner"]),
};

const removeOrBan: Case[] = [
  ...allowOnly(["moderator", "admin", "owner"], target("member")),
  ...allowOnly(["admin", "owner"], target("moderator")),
  ...allowOnly(["owner"], target("admin")),
  ...allowOnly([], { target: { role: "owner", isSelf: true } }),
];

const membershipCases: Record<ActionOf<"membership">, Case[]> = {
  read_own: allowOnly(signedIn),
  list: [
    ...allowOnly(["member", "moderator", "admin", "owner"], { entitled: true }),
    ...allowOnly(["moderator", "admin", "owner"], { entitled: false }),
  ],
  read_profile: [
    ...allowOnly(["member", "moderator", "admin", "owner"], { entitled: true }),
    ...allowOnly(["moderator", "admin", "owner"], { entitled: false }),
    ...allowOnly(["moderator", "admin", "owner"], { ...pub, entitled: false }),
  ],
  update_own_profile: allowOnly(members),
  join: [...allowOnly([...signedIn], pub), ...allowOnly([...signedIn], priv)],
  leave: allowOnly(["member", "moderator", "admin"]),
  approve: allowOnly(["moderator", "admin", "owner"]),
  remove: removeOrBan,
  ban: removeOrBan,
  change_role: [
    ...allowOnly(["admin", "owner"], target("member")),
    ...allowOnly(["admin", "owner"], target("moderator")),
    ...allowOnly(["owner"], target("admin")),
    ...allowOnly([], { target: { role: "owner", isSelf: true } }),
  ],
  reset_points: allowOnly(["admin", "owner"]),
  grant_comp: allowOnly(["admin", "owner"]),
  manage: allowOnly(["moderator", "admin", "owner"]),
  read_email: allowOnly(["admin", "owner"]),
  assign_admin: allowOnly(["owner"]),
};

const entitledReaders: Case[] = [
  ...allowOnly(members, { entitled: true }),
  ...allowOnly(["moderator", "admin", "owner"], { entitled: false }),
  ...allowOnly(["moderator", "admin", "owner"], { ...pub, entitled: false }),
];
const managers: Persona[] = ["admin", "owner"];

const courseCases: Record<ActionOf<"course">, Case[]> = {
  read: entitledReaders,
  read_drafts: [...allowOnly(managers, { entitled: true }), ...allowOnly(managers, pub)],
  create: allowOnly(managers, { entitled: true }),
  update: allowOnly(managers, { entitled: true }),
  delete: allowOnly(managers, { entitled: true }),
  publish: allowOnly(managers, { entitled: true }),
  reorder: allowOnly(managers, { entitled: true }),
  publish_agent_version: allowOnly(managers, { entitled: true }),
  manage_agent_access: [...allowOnly(managers, { entitled: true }), ...allowOnly(managers, pub)],
};

const lessonCases: Record<ActionOf<"lesson">, Case[]> = {
  read: courseCases.read,
  read_drafts: courseCases.read_drafts,
  create: courseCases.create,
  update: courseCases.update,
  delete: courseCases.delete,
  publish: courseCases.publish,
  reorder: courseCases.reorder,
  update_progress: entitledReaders,
};

const settingsCases: Record<ActionOf<"settings">, Case[]> = {
  read: allowOnly(managers),
  update: allowOnly(managers),
  custom_domain: allowOnly(["owner"]),
};

const appearanceCases: Record<ActionOf<"appearance">, Case[]> = {
  update: allowOnly(managers),
};

const inviteCases: Record<ActionOf<"invite">, Case[]> = {
  manage: [...allowOnly(managers), ...allowOnly(managers, pub)],
};

const categoryCases: Record<ActionOf<"category">, Case[]> = {
  manage: [...allowOnly(managers), ...allowOnly(managers, pub)],
  post_restricted: [
    ...allowOnly(["moderator", "admin", "owner"]),
    ...allowOnly(["moderator", "admin", "owner"], pub),
  ],
};

const exportCases: Record<ActionOf<"export">, Case[]> = {
  create: allowOnly(["owner"]),
  members: allowOnly(["owner"]),
};

const migrationCases: Record<ActionOf<"migration">, Case[]> = {
  export: [...allowOnly(["owner"]), ...allowOnly(["owner"], pub)],
  import: [...allowOnly(["owner"]), ...allowOnly(["owner"], pub)],
  import_members: [...allowOnly(["owner"]), ...allowOnly(["owner"], pub)],
};

const paymentCases: Record<ActionOf<"payment">, Case[]> = {
  read: allowOnly(managers),
  connect: allowOnly(["owner"]),
  edit_plan: allowOnly(["owner"]),
  refund: allowOnly(["owner"]),
  link_subscriptions: allowOnly(managers),
  purchase: [
    ...allowOnly(["signed_in_guest", "platform_admin", "member"], priv),
    ...allowOnly(["signed_in_guest", "platform_admin", "member"], pub),
  ],
  read_own: allowOnly(signedIn),
};

const reportCases: Record<ActionOf<"report">, Case[]> = {
  create: [...allowOnly(members), ...allowOnly(members, pub)],
  review: [
    ...allowOnly(["moderator", "admin", "owner"]),
    ...allowOnly(["moderator", "admin", "owner"], pub),
  ],
};

const ownReview = { ownsResource: true };

const reviewCases: Record<ActionOf<"review">, Case[]> = {
  read: [...allowOnly(everyone), ...allowOnly(everyone, pub)],
  create: [...allowOnly(members), ...allowOnly(members, pub)],
  edit: [...allowOnly([]), ...allowOnly(members, ownReview)],
  delete: [...allowOnly([]), ...allowOnly(members, ownReview)],
  report: allowOnly(["signed_in_guest", "platform_admin", ...members]),
  reply: [...allowOnly(["owner"]), ...allowOnly(["owner"], ownReview)],
  hide: [...allowOnly(["owner"]), ...allowOnly(["owner"], pub)],
};

const auditLogCases: Record<ActionOf<"audit_log">, Case[]> = {
  read: allowOnly(managers),
  export: allowOnly(["owner"]),
};

const agentCases: Record<ActionOf<"agent">, Case[]> = {
  read: allowOnly(["admin", "owner"]),
  create: allowOnly(["admin", "owner"]),
  create_own: allowOnly(members),
  manage: [
    ...allowOnly(members, { ownsResource: true }),
    ...allowOnly(["owner"], { ownsResource: false }),
  ],
};

const delegationCases: Record<ActionOf<"delegation">, Case[]> = {
  create: [...allowOnly(members), ...allowOnly(members, pub)],
  manage: [
    ...allowOnly(members, { ownsResource: true }),
    ...allowOnly(managers, { ownsResource: false }),
  ],
  read_all: allowOnly(managers),
};

const submissionCases: Record<ActionOf<"submission">, Case[]> = {
  create: [...allowOnly(members), ...allowOnly(members, pub)],
  read_own: allowOnly(members),
  read_summary: allowOnly(managers),
};

const approvalCases: Record<ActionOf<"approval">, Case[]> = {
  read: allowOnly(["admin", "owner"]),
  decide: allowOnly(["admin", "owner"]),
  read_own: allowOnly(["member", "moderator", "admin", "owner"]),
};

const webhookCases: Record<ActionOf<"webhook">, Case[]> = {
  manage: [...allowOnly(managers), ...allowOnly(managers, pub)],
};

const staff: Persona[] = ["moderator", "admin", "owner"];
const owns = { ownsResource: true };
const ownedOnly: Case[] = [...allowOnly([]), ...allowOnly(members, owns)];
const ownedOrStaff: Case[] = [...allowOnly(staff), ...allowOnly(members, owns)];
const entitledOrPublicPreview: Case[] = [
  ...allowOnly(members, { ...priv, entitled: true }),
  ...allowOnly(staff, { ...priv, entitled: false }),
  ...allowOnly(everyone, { ...pub, entitled: false }),
];

const postCases: Record<ActionOf<"post">, Case[]> = {
  read: entitledOrPublicPreview,
  create: entitledReaders,
  like: entitledReaders,
  edit: ownedOnly,
  delete: ownedOrStaff,
  pin: [...allowOnly(managers), ...allowOnly(managers, owns)],
  move: allowOnly(staff),
  email_all: allowOnly(managers),
  unfollow: allowOnly(signedIn),
  read_deleted: allowOnly(staff),
  read_scheduled: allowOnly(staff),
};

const commentCases: Record<ActionOf<"comment">, Case[]> = {
  read: entitledOrPublicPreview,
  create: entitledReaders,
  like: entitledReaders,
  edit: ownedOnly,
  delete: ownedOrStaff,
  read_deleted: [...allowOnly(staff), ...allowOnly(staff, owns)],
};

const eventCases: Record<ActionOf<"event">, Case[]> = {
  read_title: [...allowOnly(everyone, pub), ...allowOnly(members, priv)],
  read: entitledReaders,
  create: allowOnly(managers),
  update: allowOnly(managers),
  delete: allowOnly(managers),
  cancel_occurrence: allowOnly(managers),
  rsvp: entitledReaders,
  read_rsvps: [...allowOnly(managers), ...allowOnly(managers, { entitled: true })],
};

const apiTokenCases: Record<ActionOf<"api_token">, Case[]> = {
  create_own: [...allowOnly(members), ...allowOnly(members, pub)],
  read_all: allowOnly(managers),
  manage_all: [...allowOnly(["owner"]), ...allowOnly(["owner"], owns)],
};

const leaderboardCases: Record<ActionOf<"leaderboard">, Case[]> = {
  read: entitledReaders,
};

const accountCases: Record<ActionOf<"account">, Case[]> = {
  update_own: allowOnly(signedIn),
};

const notificationCases: Record<ActionOf<"notification">, Case[]> = {
  read: allowOnly(signedIn),
  mark_read: allowOnly(signedIn),
};

const creatorFeedbackCases: Record<ActionOf<"creator_feedback">, Case[]> = {
  answer: allowOnly(["owner"]),
};

const tables: { [R in Resource]: Record<ActionOf<R>, Case[]> } = {
  community: communityCases,
  membership: membershipCases,
  post: postCases,
  comment: commentCases,
  category: categoryCases,
  course: courseCases,
  lesson: lessonCases,
  event: eventCases,
  settings: settingsCases,
  appearance: appearanceCases,
  invite: inviteCases,
  export: exportCases,
  migration: migrationCases,
  payment: paymentCases,
  webhook: webhookCases,
  audit_log: auditLogCases,
  report: reportCases,
  review: reviewCases,
  api_token: apiTokenCases,
  agent: agentCases,
  delegation: delegationCases,
  submission: submissionCases,
  approval: approvalCases,
  leaderboard: leaderboardCases,
  account: accountCases,
  notification: notificationCases,
  creator_feedback: creatorFeedbackCases,
};

function describeCases<R extends Resource>(resource: R): void {
  const table: Record<ActionOf<R>, Case[]> = tables[resource];
  const rules: Readonly<Record<string, RoleRules>> = matrix[resource];
  for (const action of Object.keys(table) as ActionOf<R>[]) {
    const cases = table[action];
    const openToEveryone = Object.values(rules[action] ?? {}).every((rule) => rule === "allow");
    describe(`${resource}.${action}`, () => {
      it.skipIf(openToEveryone)("includes a denied case", () => {
        expect(cases.some(([, , expected]) => !expected)).toBe(true);
      });

      it.each(cases.map(([p, ctx, expected]) => ({ p, ctx, expected })))(
        "$p with $ctx is allowed: $expected",
        ({ p, ctx, expected }) => {
          const { actor, role } = persona(p);
          const context: PolicyContext = { ...ctx, role };

          expect(can(actor, action, resource, context)).toBe(expected);
        },
      );
    });
  }
}

for (const resource of resources) {
  describeCases(resource);
}

describe("matrix coverage", () => {
  it.each(resources)("tests every action of %s per role", (resource) => {
    expect(Object.keys(tables[resource]).sort()).toEqual(Object.keys(matrix[resource]).sort());
  });

  it("defines a rule for every role on every action of every resource", () => {
    for (const resource of resources) {
      for (const rules of Object.values(matrix[resource])) {
        expect(Object.keys(rules).sort()).toEqual([...roles].sort());
      }
    }
  });

  it("includes the MVP resources and the future ones as data", () => {
    expect(resources).toEqual(
      expect.arrayContaining([
        "community",
        "membership",
        "post",
        "comment",
        "course",
        "lesson",
        "event",
        "settings",
        "appearance",
        "invite",
        "export",
        "payment",
        "audit_log",
        "api_token",
        "agent",
        "notification",
        "leaderboard",
        "account",
      ]),
    );
  });
});

describe("guest behavior", () => {
  const guest: Actor = { kind: "guest" };

  it("lets a signed out guest read a public community", () => {
    expect(can(guest, "read", "community", { communityPrivacy: "public" })).toBe(true);
  });

  it("denies a signed out guest a private community", () => {
    expect(can(guest, "read", "community", { communityPrivacy: "private" })).toBe(false);
  });

  it("treats a missing privacy as private", () => {
    expect(can(guest, "read", "community", {})).toBe(false);
  });

  it("lets a guest read the public post preview but not a private one", () => {
    expect(can(guest, "read", "post", { communityPrivacy: "public" })).toBe(true);
    expect(can(guest, "read", "post", { communityPrivacy: "private" })).toBe(false);
  });

  it("ignores a community role passed for a signed out actor", () => {
    expect(can(guest, "update", "community", { role: "owner" })).toBe(false);
  });
});

describe("other resources", () => {
  const member = persona("member");
  const owner = persona("owner");

  it("lets a member edit only their own post", () => {
    expect(can(member.actor, "edit", "post", { role: "member", ownsResource: true })).toBe(true);
    expect(can(member.actor, "edit", "post", { role: "member", ownsResource: false })).toBe(false);
  });

  it("requires an entitlement for a member to create a post", () => {
    expect(can(member.actor, "create", "post", { role: "member", entitled: true })).toBe(true);
    expect(can(member.actor, "create", "post", { role: "member" })).toBe(false);
  });

  it("allows exports only for the owner", () => {
    expect(can(owner.actor, "create", "export", { role: "owner" })).toBe(true);
    expect(can(member.actor, "create", "export", { role: "admin" })).toBe(false);
  });
});

describe("assertCan", () => {
  it("returns when the action is allowed", () => {
    expect(() =>
      assertCan({ kind: "guest" }, "read", "community", { communityPrivacy: "public" }),
    ).not.toThrow();
  });

  it("throws a ForbiddenError carrying the action and resource when denied", () => {
    const attempt = () =>
      assertCan(persona("member").actor, "delete", "community", { role: "member" });

    expect(attempt).toThrow(ForbiddenError);
    expect(attempt).toThrow(
      expect.objectContaining({ code: "forbidden", action: "delete", resource: "community" }),
    );
  });
});

describe("a member whose paid access ended", () => {
  const ended = persona("member");
  const visitor = persona("signed_out");

  it.each(["public", "private"] as const)(
    "is never allowed less than a signed out visitor in a %s community",
    (communityPrivacy) => {
      const lessThanVisitor: string[] = [];
      for (const resource of resources) {
        const actions: Readonly<Record<string, RoleRules>> = matrix[resource];
        for (const action of Object.keys(actions) as ActionOf<Resource>[]) {
          const asVisitor = can(visitor.actor, action, resource, {
            role: visitor.role,
            communityPrivacy,
          });
          const asEnded = can(ended.actor, action, resource, {
            role: "member",
            communityPrivacy,
            entitled: false,
          });
          if (asVisitor && !asEnded) {
            lessThanVisitor.push(`${resource}.${action}`);
          }
        }
      }
      expect(lessThanVisitor).toEqual([]);
    },
  );
});
