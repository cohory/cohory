import { describe, expect, it } from "vitest";

import { MigrationError } from "../errors";
import { applyAuthorChoices, assertAuthorChoices } from "./author-choices";
import { RecordsBuilder, type MemberInput } from "./builder";
import { markdownToDocument } from "./rich-text";
import { importerTestContext } from "./test-context";

function member(email: string): MemberInput {
  return {
    file: "members.csv",
    row: email,
    email,
    name: "Sam Lee",
    sourceIds: [],
    role: "member",
    sourceRole: null,
    joinedAt: null,
    lastSeenAt: null,
    bio: null,
    joinAnswers: [],
    points: null,
  };
}

function build() {
  const builder = new RecordsBuilder("skool", importerTestContext());
  builder.addMember(member("one@example.test"));
  builder.addMember(member("two@example.test"));
  builder.addPost({
    file: "posts.json",
    row: "item 1",
    sourceKeys: ["p1"],
    title: "Hi",
    body: markdownToDocument("Hi there"),
    author: { name: "Sam Lee" },
    category: null,
    createdAt: null,
    updatedAt: null,
    pinned: false,
  });
  return builder.build();
}

describe("author choices", () => {
  it("moves posts of an ambiguous name to the chosen member and drops the placeholder", () => {
    const { records, report } = build();
    const [ambiguous] = report.ambiguousAuthors;
    const second = ambiguous?.candidates[1];
    if (!ambiguous || !second) throw new Error("expected an ambiguous author");

    const choices = { [ambiguous.placeholderId]: second.id };
    expect(() => assertAuthorChoices(choices, report.ambiguousAuthors)).not.toThrow();
    const applied = applyAuthorChoices(records, choices);

    expect(applied.posts[0]?.authorId).toBe(second.id);
    expect(applied.users.map((user) => user.id)).not.toContain(ambiguous.placeholderId);
    expect(applied.users.filter((user) => !user.erased)).toHaveLength(2);
  });

  it("refuses a member who is not a candidate for that name", () => {
    const { records, report } = build();
    const [ambiguous] = report.ambiguousAuthors;
    if (!ambiguous) throw new Error("expected an ambiguous author");
    const outsider = records.users.find((user) => user.id === ambiguous.placeholderId)?.id ?? "";
    expect(() =>
      assertAuthorChoices({ [ambiguous.placeholderId]: outsider }, report.ambiguousAuthors),
    ).toThrow(MigrationError);
    expect(() =>
      assertAuthorChoices({ "not-a-placeholder": "x" }, report.ambiguousAuthors),
    ).toThrow(MigrationError);
  });
});
