import { can, matrix, type Actor, type ActionOf, type CommunityRole } from "@cohory/authz";
import { describe, expect, it } from "vitest";

type Persona = "owner" | "admin" | "moderator" | "member" | "non_member" | "guest";
type Ownership = "author" | "other";

const personas: readonly Persona[] = [
  "owner",
  "admin",
  "moderator",
  "member",
  "non_member",
  "guest",
];
const userId = "0192f0a0-0000-7000-8000-000000000001";

function setup(persona: Persona): { actor: Actor; role: CommunityRole | null } {
  if (persona === "guest") {
    return { actor: { kind: "guest" }, role: null };
  }
  const actor: Actor = { kind: "user", userId, platformAdmin: false };
  return { actor, role: persona === "non_member" ? null : persona };
}

const staff: Persona[] = ["owner", "admin", "moderator"];
const members: Persona[] = [...staff, "member"];
const everyone: Persona[] = [...personas];

interface Expectation {
  readonly public: readonly Persona[];
  readonly private: readonly Persona[];
}

function same(allowed: readonly Persona[]): Expectation {
  return { public: allowed, private: allowed };
}

type OwnedExpectation = Record<Ownership, Expectation>;

function owned(author: readonly Persona[], other: readonly Persona[]): OwnedExpectation {
  return { author: same(author), other: same(other) };
}

function unowned(expectation: Expectation): OwnedExpectation {
  return { author: expectation, other: expectation };
}

const read: Expectation = { public: everyone, private: members };

const postTable: Record<ActionOf<"post">, OwnedExpectation> = {
  read: unowned(read),
  create: unowned(same(members)),
  like: unowned(same(members)),
  edit: owned(members, []),
  delete: owned(members, staff),
  pin: unowned(same(["owner", "admin"])),
  move: unowned(same(staff)),
  email_all: unowned(same(["owner", "admin"])),
  unfollow: unowned(same([...members, "non_member"])),
  read_deleted: unowned(same(staff)),
  read_scheduled: unowned(same(staff)),
};

const commentTable: Record<ActionOf<"comment">, OwnedExpectation> = {
  read: unowned(read),
  create: unowned(same(members)),
  like: unowned(same(members)),
  edit: owned(members, []),
  delete: owned(members, staff),
  read_deleted: unowned(same(staff)),
};

function cases(table: Record<string, OwnedExpectation>) {
  return Object.entries(table).flatMap(([action, byOwnership]) =>
    (["author", "other"] as const).flatMap((ownership) =>
      (["public", "private"] as const).flatMap((privacy) =>
        personas.map((persona) => ({
          action,
          ownership,
          privacy,
          persona,
          expected: byOwnership[ownership][privacy].includes(persona),
        })),
      ),
    ),
  );
}

describe("post permissions", () => {
  it.each(cases(postTable))(
    "post.$action by $persona ($ownership, $privacy community) is allowed: $expected",
    ({ action, ownership, privacy, persona, expected }) => {
      const { actor, role } = setup(persona);
      const allowed = can(actor, action as ActionOf<"post">, "post", {
        role,
        communityPrivacy: privacy,
        entitled: true,
        ownsResource: ownership === "author",
      });

      expect(allowed).toBe(expected);
    },
  );

  it("covers every post action in the matrix", () => {
    expect(Object.keys(postTable).sort()).toEqual(Object.keys(matrix.post).sort());
  });
});

describe("comment permissions", () => {
  it.each(cases(commentTable))(
    "comment.$action by $persona ($ownership, $privacy community) is allowed: $expected",
    ({ action, ownership, privacy, persona, expected }) => {
      const { actor, role } = setup(persona);
      const allowed = can(actor, action as ActionOf<"comment">, "comment", {
        role,
        communityPrivacy: privacy,
        entitled: true,
        ownsResource: ownership === "author",
      });

      expect(allowed).toBe(expected);
    },
  );

  it("covers every comment action in the matrix", () => {
    expect(Object.keys(commentTable).sort()).toEqual(Object.keys(matrix.comment).sort());
  });
});

describe("entitlement", () => {
  it("denies a member without an entitlement from creating, liking, or reading", () => {
    const { actor } = setup("member");
    const context = { role: "member", communityPrivacy: "private", entitled: false } as const;

    expect(can(actor, "create", "post", context)).toBe(false);
    expect(can(actor, "like", "post", context)).toBe(false);
    expect(can(actor, "read", "post", context)).toBe(false);
    expect(can(actor, "create", "comment", context)).toBe(false);
  });
});
