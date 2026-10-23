import { parseContent, renderContentHtml } from "@cohory/posts";
import { describe, expect, it } from "vitest";

import { entitySchemas } from "../format/records";
import { circleImporter } from "./circle";
import { fixtureFiles } from "./fixtures";
import { detectSource } from "./index";
import { importerTestContext } from "./test-context";

const files = fixtureFiles("circle");
const { records, report } = circleImporter.parse(files, importerTestContext());
const html = (body: unknown) => renderContentHtml(parseContent(body, { allowImages: false }));

describe("Circle importer", () => {
  it("detects each file of the Circle data export", () => {
    expect(files.map((file) => [file.name, circleImporter.detect(file).kind])).toEqual([
      ["comments.csv", "comments"],
      ["members.csv", "members"],
      ["posts.csv", "posts"],
      ["spaces.csv", "spaces"],
    ]);
    expect(detectSource(files).importer).toBe("circle");
  });

  it("produces records that match the archive schemas", () => {
    for (const [entity, rows] of Object.entries(records)) {
      const schema = entitySchemas[entity as keyof typeof entitySchemas];
      for (const row of rows) expect(() => schema.parse(row)).not.toThrow();
    }
  });

  it("imports members with roles, headline, and last active date", () => {
    expect(records.memberships.map((row) => row.role)).toEqual(["admin", "moderator"]);
    expect(records.memberships[0]).toMatchObject({
      bio: "Runs the studio",
      joinedAt: "2024-11-02T15:04:05.000Z",
      lastSeenAt: "2026-10-01T08:00:00.000Z",
    });
    expect(report.skipped).toContainEqual({
      file: "members.csv",
      row: "line 4",
      reason: "This person was invited but did not join.",
      values: expect.objectContaining({ Member: expect.any(String) }),
    });
    expect(report.unknownColumns).toEqual([{ file: "members.csv", columns: ["Company size"] }]);
  });

  it("flags members on a paywall and says paid access does not transfer", () => {
    const csv = [
      "Email,First name,Last name,Headline,Paywalls",
      "paid@example.test,Pat,Paid,,Inner circle (monthly)",
      "free@example.test,Fay,Free,,",
      "none@example.test,Ned,None,,None",
    ].join("\n");
    const parsed = circleImporter.parse(
      [{ name: "members.csv", bytes: new TextEncoder().encode(csv) }],
      importerTestContext(),
    );
    expect(parsed.report.paying).toEqual(["paid@example.test"]);
    expect(parsed.report.unknownColumns).toEqual([]);
    expect(parsed.report.warnings).toEqual(
      expect.arrayContaining([
        "Paywalls are not imported. Paid access does not transfer.",
        "1 member was paying. After the import, give them free time to subscribe again on Bring your existing subscribers.",
      ]),
    );
    expect(report.paying).toEqual([]);
  });

  it("maps spaces to categories and keeps formatting without unsafe parts", () => {
    expect(records.categories.map((row) => row.name)).toEqual([
      "Start here",
      "Show and tell",
      "Lost space",
    ]);
    const [first, second, third] = records.posts;
    expect(first?.body.content.some((block) => (block as { type: string }).type === "embed")).toBe(
      true,
    );
    const rendered = html(second?.body);
    expect(rendered).toContain('href="https://example.test/project"');
    expect(rendered).not.toMatch(/<img|<style|display:none/);
    expect(html(third?.body)).toBe("<p>Line one<br>Line two</p>");
    expect(report.formerMemberAuthors).toBe(1);
  });

  it("threads replies and reports comments whose post is missing", () => {
    expect(records.comments).toHaveLength(3);
    const [thanks, anytime, looks] = records.comments;
    expect(anytime?.parentId).toBe(thanks?.id);
    expect(html(looks?.body)).toBe("<p>Looks great</p>");
    expect(report.skipped.map((row) => row.reason)).toContain(
      "The post it belongs to is not in the files.",
    );
  });

  it("reads posts and comments saved from the Admin API", () => {
    const api = fixtureFiles("circle-api");
    expect(api.map((file) => circleImporter.detect(file).kind)).toEqual([
      "commentsJson",
      "members",
      "postsJson",
    ]);
    const parsed = circleImporter.parse(api, importerTestContext());
    const [notes] = parsed.records.posts;
    expect(notes?.title).toBe("Office hours notes");
    expect(notes?.pinnedAt).toBe("2025-04-01T09:00:00.000Z");
    expect(html(notes?.body)).toBe("<p>Notes from <strong>Tuesday</strong>.</p>");
    const omar = parsed.records.users.find((user) => user.email === "omar@circle-fixture.test");
    expect(notes?.authorId).toBe(omar?.id);
    expect(parsed.records.comments).toHaveLength(1);
    expect(parsed.records.comments[0]?.postId).toBe(notes?.id);
  });
});
