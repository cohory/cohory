import {
  can,
  matrix,
  type Actor,
  type ActionOf,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { describe, expect, it } from "vitest";

type Persona =
  "signed_out" | "signed_in_guest" | "member" | "moderator" | "admin" | "owner" | "platform_admin";

const userId = "0192f0a0-0000-7000-8000-000000000001";
const everyone: Persona[] = [
  "signed_out",
  "signed_in_guest",
  "member",
  "moderator",
  "admin",
  "owner",
  "platform_admin",
];

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

type Case = readonly [Persona, Omit<PolicyContext, "role">, boolean];

function allowOnly(allowed: Persona[], context: Omit<PolicyContext, "role"> = {}): Case[] {
  return everyone.map((p) => [p, context, allowed.includes(p)] as const);
}

const pub = { communityPrivacy: "public" } as const;
const priv = { communityPrivacy: "private" } as const;
const members: Persona[] = ["member", "moderator", "admin", "owner"];
const staff: Persona[] = ["moderator", "admin", "owner"];
const managers: Persona[] = ["admin", "owner"];

const entitled: Case[] = [
  ...allowOnly(members, { ...priv, entitled: true }),
  ...allowOnly(staff, { ...priv, entitled: false }),
  ...allowOnly(staff, { ...pub, entitled: false }),
];

const managerOnly: Case[] = [
  ...allowOnly(managers, { ...priv, entitled: true }),
  ...allowOnly(managers, { ...pub, entitled: true }),
];

const eventCases: Record<ActionOf<"event">, Case[]> = {
  read_title: [...allowOnly(members, priv), ...allowOnly(everyone, pub)],
  read: entitled,
  rsvp: entitled,
  create: managerOnly,
  update: managerOnly,
  delete: managerOnly,
  cancel_occurrence: managerOnly,
  read_rsvps: managerOnly,
};

describe("event policy", () => {
  it("covers every event action in the matrix", () => {
    expect(Object.keys(eventCases).sort()).toEqual(Object.keys(matrix.event).sort());
  });

  for (const action of Object.keys(eventCases) as ActionOf<"event">[]) {
    describe(`event.${action}`, () => {
      it.each(eventCases[action].map(([p, ctx, expected]) => ({ p, ctx, expected })))(
        "$p with $ctx is allowed: $expected",
        ({ p, ctx, expected }) => {
          const { actor, role } = persona(p);
          expect(can(actor, action, "event", { ...ctx, role })).toBe(expected);
        },
      );
    });
  }
});
