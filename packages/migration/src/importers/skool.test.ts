import { parseContent, renderContentHtml } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import { entitySchemas } from "../format/records";
import { fixtureFiles } from "./fixtures";
import { detectSource } from "./index";
import { skoolImporter } from "./skool";
import { importerTestContext } from "./test-context";

const context = importerTestContext();

const files = fixtureFiles("skool");
const result = skoolImporter.parse(files, context);
const { records, report } = result;

describe("Skool importer", () => {
  it("detects each Skool file and picks Skool as the source", () => {
    expect(files.map((file) => skoolImporter.detect(file).kind)).toEqual([
      "comments",
      "members",
      "posts",
    ]);
    expect(detectSource(files).importer).toBe("skool");
  });

  it("produces records that match the archive schemas", () => {
    for (const [entity, rows] of Object.entries(records)) {
      const schema = entitySchemas[entity as keyof typeof entitySchemas];
      for (const row of rows) expect(() => schema.parse(row)).not.toThrow();
    }
  });

  it("imports members with answers, points, and roles, and reports bad rows", () => {
    expect(records.users.filter((user) => !user.erased).map((user) => user.email)).toEqual([
      "ada@skool-fixture.test",
      "grace@skool-fixture.test",
      "linus@skool-fixture.test",
    ]);
    const ada = records.memberships[0];
    expect(ada?.role).toBe("admin");
    expect(ada?.joinedAt).toBe("2025-01-05T09:30:00.000Z");
    expect(ada?.joinAnswers).toEqual([
      "What brings you here?: Learning to ship",
      "How did you find us?: A friend",
    ]);
    expect(records.memberships[2]?.joinedAt).toBe("2025-03-15T00:00:00.000Z");
    expect(records.member_stats.map((row) => [row.pointsTotal, row.level])).toEqual([
      [120, 4],
      [35, 3],
      [0, 1],
    ]);
    expect(report.skipped.map((row) => [row.row, row.reason])).toEqual(
      expect.arrayContaining([
        ["line 5", "The email is missing or not valid."],
        ["line 6", "This email appears earlier in the file."],
      ]),
    );
    expect(report.unknownColumns).toEqual([{ file: "members.csv", columns: ["Favorite Color"] }]);
    expect(report.warnings).toContain(
      "Price, tier, and lifetime value are not imported. Paid access does not transfer.",
    );
  });

  it("maps categories, keeps existing category settings, and pins", () => {
    const announcements = records.categories.find((row) => row.slug === "announcements");
    expect(announcements).toMatchObject({
      name: "Announcements",
      staffOnly: true,
      color: "accent",
    });
    expect(records.categories.map((row) => row.slug)).toEqual(["announcements", "wins"]);
    expect(records.posts[0]?.pinnedAt).toBe("2025-03-01T10:00:00.000Z");
  });

  it("sanitizes bodies and keeps posts of unknown authors under their name as former member", () => {
    const wins = records.posts.find((post) => post.title === "Weekly wins");
    const html = renderContentHtml(parseContent(wins?.body, { allowImages: false }));
    expect(html).toContain("<strong>win</strong>");
    expect(html).not.toMatch(/script|alert|onerror|javascript|<img/);
    const author = records.users.find((user) => user.id === wins?.authorId);
    expect(author).toMatchObject({
      erased: true,
      name: expect.stringMatching(/ \(former member\)$/),
    });
    expect(report.formerMemberAuthors).toBe(1);
    const pictureOnly = records.posts.find((post) => post.title === "A picture only");
    expect(renderContentHtml(parseContent(pictureOnly?.body, { allowImages: false }))).toBe(
      "<p>A picture only</p>",
    );
  });

  it("flattens nested replies to one level and links the separate comments file", () => {
    const welcome = records.posts[0];
    const onWelcome = records.comments.filter((comment) => comment.postId === welcome?.id);
    expect(onWelcome).toHaveLength(3);
    const top = onWelcome.find((comment) => comment.parentId === null);
    expect(onWelcome.filter((comment) => comment.parentId === top?.id)).toHaveLength(2);
    expect(welcome?.lastActivityAt).toBe("2025-03-01T12:00:00.000Z");
    expect(records.comments).toHaveLength(4);
    expect(report.skipped.map((row) => row.reason)).toContain(
      "The post it belongs to is not in the files.",
    );
  });

  it("reports files it does not read without failing", () => {
    const broken = skoolImporter.parse(
      [
        ...files,
        { name: "notes.txt", bytes: new TextEncoder().encode("hello") },
        { name: "bad.json", bytes: new TextEncoder().encode("{not json") },
      ],
      context,
    );
    expect(broken.records.posts).toHaveLength(3);
    expect(broken.report.warnings).toContain(
      "notes.txt is not a file this importer reads. It was left out.",
    );
  });

  it("treats an impossible join date as unreadable and reads a day first file day first", () => {
    const csv = [
      "FirstName,LastName,Email,JoinedDate",
      "Ana,One,ana@example.test,13/45/2025",
      "Bo,Two,bo@example.test,03/04/2025",
      "Cy,Three,cy@example.test,25/04/2025",
    ].join("\n");
    const parsed = skoolImporter.parse(
      [{ name: "members.csv", bytes: new TextEncoder().encode(csv) }],
      importerTestContext(),
    );
    expect(parsed.records.memberships.map((row) => row.joinedAt)).toEqual([
      "2026-10-18T12:00:00.000Z",
      "2025-04-03T00:00:00.000Z",
      "2025-04-25T00:00:00.000Z",
    ]);
    expect(parsed.report.dateOrder).toBe("dmy");
    expect(parsed.report.warnings).toContain(
      "Some join dates could not be read. Those members joined at the import time.",
    );
  });

  it("flags members who were paying from the Price and Tier columns", () => {
    expect(report.paying).toEqual(["grace@skool-fixture.test"]);
    expect(report.warnings).toContain(
      "1 member was paying. After the import, give them free time to subscribe again on Bring your existing subscribers.",
    );
  });

  it("keeps the original cells of a skipped member row", () => {
    const row = report.skipped.find((entry) => entry.row === "line 5");
    expect(row?.values).toMatchObject({ Email: expect.any(String) });
  });
});
