import { describe, expect, it } from "vitest";

import { RecordsBuilder, type MemberInput } from "./builder";
import { markdownToDocument } from "./rich-text";
import { importerTestContext } from "./test-context";

function member(email: string, name: string, extra: Partial<MemberInput> = {}): MemberInput {
  return {
    file: "members.csv",
    row: `line ${email}`,
    email,
    name,
    sourceIds: [],
    role: "member",
    sourceRole: null,
    joinedAt: null,
    lastSeenAt: null,
    bio: null,
    joinAnswers: [],
    points: null,
    ...extra,
  };
}

function post(author: { name?: string; email?: string; handle?: string }, title = "Hello") {
  return {
    file: "posts.json",
    row: `item ${title}`,
    sourceKeys: [title],
    title,
    body: markdownToDocument(`Body of ${title}`),
    author,
    category: null,
    createdAt: null,
    updatedAt: null,
    pinned: false,
  };
}

describe("RecordsBuilder authors", () => {
  it("counts same name authors apart from missing ones and lists the candidates", () => {
    const builder = new RecordsBuilder("skool", importerTestContext());
    builder.addMember(member("sam.one@example.test", "Sam Lee"));
    builder.addMember(member("sam.two@example.test", "Sam Lee"));
    builder.addPost(post({ name: "Sam Lee" }, "First"));
    builder.addPost(post({ name: "sam  lee" }, "Second"));
    builder.addPost(post({ name: "Someone Who Left" }, "Third"));
    const { records, report } = builder.build();

    expect(report.formerMemberAuthors).toBe(1);
    expect(report.ambiguousAuthors).toHaveLength(1);
    const [ambiguous] = report.ambiguousAuthors;
    expect(ambiguous?.name).toBe("Sam Lee");
    expect(ambiguous?.candidates.map((candidate) => candidate.email)).toEqual([
      "sam.one@example.test",
      "sam.two@example.test",
    ]);
    expect(records.posts[0]?.authorId).toBe(ambiguous?.placeholderId);
    expect(records.posts[1]?.authorId).toBe(ambiguous?.placeholderId);
    expect(report.warnings).toContain(
      "1 author name matches more than one member. Choose who wrote their posts below.",
    );
    expect(report.warnings).toContain(
      "1 author is not in the members file. Their posts and comments keep their name, marked as former member.",
    );
    expect(report.warnings.join(" ")).not.toMatch(/2 authors/);
  });

  it("keeps the source name with a former member marker and never a login", () => {
    const builder = new RecordsBuilder("skool", importerTestContext());
    builder.addPost(post({ name: "Someone Who Left" }));
    builder.addPost(post({ email: "gone@example.test" }, "No name"));
    const { records } = builder.build();
    const names = records.users.map((user) => [user.name, user.erased, user.email]);
    expect(names).toEqual([
      ["Someone Who Left (former member)", true, expect.stringMatching(/@import\.invalid$/)],
      ["Former member", true, expect.stringMatching(/@import\.invalid$/)],
    ]);
  });

  it("matches an author by handle before falling back to an ambiguous name", () => {
    const builder = new RecordsBuilder("circle", importerTestContext());
    builder.addMember(
      member("a@example.test", "Sam Lee", { sourceIds: ["https://x.test/u/sam-a"] }),
    );
    builder.addMember(member("b@example.test", "Sam Lee"));
    builder.addPost(post({ name: "Sam Lee", handle: "https://x.test/u/sam-a" }));
    const { records, report } = builder.build();
    expect(report.ambiguousAuthors).toEqual([]);
    expect(records.posts[0]?.authorId).toBe(records.memberships[0]?.userId);
  });
});

describe("RecordsBuilder mapping", () => {
  it("lists admins and moderators with their source role, categories, and a sample post", () => {
    const builder = new RecordsBuilder("skool", importerTestContext());
    builder.addMember(
      member("o@example.test", "Olga Owner", { role: "admin", sourceRole: "owner" }),
    );
    builder.addMember(
      member("m@example.test", "Max Mod", { role: "moderator", sourceRole: "mod" }),
    );
    builder.addMember(member("p@example.test", "Pat Plain"));
    builder.addPost({ ...post({ name: "Olga Owner" }, "Welcome"), category: "Announcements" });
    builder.addPost({ ...post({ name: "Max Mod" }, "Wins"), category: "Weekly wins" });
    const { report } = builder.build();

    expect(report.mapping.roles).toEqual([
      { name: "Olga Owner", email: "o@example.test", role: "admin", sourceRole: "owner" },
      { name: "Max Mod", email: "m@example.test", role: "moderator", sourceRole: "mod" },
    ]);
    expect(report.mapping.rolesTotal).toBe(2);
    expect(report.mapping.categories).toEqual([
      { source: "Announcements", target: "Announcements", existing: true },
      { source: "Weekly wins", target: "Weekly wins", existing: false },
    ]);
    expect(report.mapping.sample).toEqual({
      title: "Welcome",
      author: "Olga Owner",
      category: "Announcements",
      excerpt: "Body of Welcome",
    });
  });

  it("reports which date order was used", () => {
    const builder = new RecordsBuilder("skool", importerTestContext());
    expect(builder.build().report.dateOrder).toBeNull();
    builder.noteDateOrder("mdy");
    builder.noteDateOrder("dmy");
    builder.noteDateOrder(null);
    expect(builder.build().report.dateOrder).toBe("dmy");
  });
});
