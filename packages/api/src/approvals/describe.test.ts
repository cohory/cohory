import type { ApprovalRecordedInput } from "@cohory/agents/approvals";
import { describe, expect, it } from "vitest";

import { describeProposal, maxDiffLines, type DescribeContext } from "./describe";

const slugBase = "/api/v1/communities/makers";
const idBase = "/api/v1/communities/0192a7c0-0000-7000-8000-000000000001";

function context(input: Partial<ApprovalRecordedInput>, reads: string[] = []): DescribeContext {
  return {
    input: { params: {}, query: {}, body: null, ...input },
    slugBase,
    idBase,
    read: async (path) => {
      reads.push(path);
      return { name: "Sam Lee", role: "member", title: "Getting started" };
    },
  };
}

function resolved(path: string): string {
  return new URL(path, "http://check.invalid").pathname;
}

describe("describeProposal reads", () => {
  it.each([
    ["deleteCourse", { courseSlug: "../../other/courses/x" }],
    ["publishCourse", { courseSlug: "..%2F..%2Fother" }],
    ["deleteCalendarEvent", { eventSlug: "../../../other/calendar/events/x" }],
    ["removeMember", { userId: "../../other/members/someone" }],
    ["changeMemberRole", { userId: "../../../../communities/other/members/x" }],
  ])("keeps the %s read inside the community for %j", async (operationId, params) => {
    const reads: string[] = [];
    await describeProposal(operationId, context({ params }, reads));
    expect(reads).toHaveLength(1);
    expect(resolved(reads[0] ?? "").startsWith(`${slugBase}/`)).toBe(true);
    expect(resolved(reads[0] ?? "")).not.toContain("other/");
  });

  it("encodes each interpolated segment", async () => {
    const reads: string[] = [];
    await describeProposal("deleteCourse", context({ params: { courseSlug: "a/b?c#d" } }, reads));
    expect(reads).toEqual([`${slugBase}/courses/a%2Fb%3Fc%23d`]);
  });

  it.each([[".."], ["."]])("does not read for the dot segment %j", async (courseSlug) => {
    const reads: string[] = [];
    const described = await describeProposal(
      "deleteCourse",
      context({ params: { courseSlug } }, reads),
    );
    expect(reads).toEqual([]);
    expect(described).toMatchObject({
      kind: "described",
      summary: expect.stringMatching(/^delete the course/),
    });
  });

  it("encodes the new owner id from the transfer body", async () => {
    const reads: string[] = [];
    await describeProposal("transferOwnership", context({ body: { userId: "../x" } }, reads));
    expect(reads).toEqual([`${slugBase}/members/..%2Fx`]);
  });
});

describe("describeProposal diffs", () => {
  it("lists every changed setting", async () => {
    const body = { name: "New", description: "Text", privacy: "public", reviewsEnabled: true };
    const described = await describeProposal("updateCommunitySettings", context({ body }));
    expect(described.kind).toBe("described");
    if (described.kind !== "described") return;
    expect(described.diff.map((line) => line.label)).toEqual([
      "Name",
      "Description",
      "Privacy",
      "Reviews enabled",
    ]);
  });

  it(`refuses a diff with more than ${maxDiffLines} lines instead of cutting it`, async () => {
    const body = Object.fromEntries(
      Array.from({ length: maxDiffLines + 1 }, (_, index) => [`field${index}`, index]),
    );
    const described = await describeProposal("updateCommunityAppearance", context({ body }));
    expect(described).toEqual({ kind: "too_large", lines: maxDiffLines + 1 });
  });

  it(`accepts a diff with exactly ${maxDiffLines} lines`, async () => {
    const body = Object.fromEntries(
      Array.from({ length: maxDiffLines }, (_, index) => [`field${index}`, index]),
    );
    const described = await describeProposal("updateCommunityAppearance", context({ body }));
    expect(described.kind).toBe("described");
    if (described.kind !== "described") return;
    expect(described.diff).toHaveLength(maxDiffLines);
  });
});

describe("describeProposal for a scheduled post", () => {
  const body = {
    title: "Monday call",
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "See you Monday." }] },
        { type: "paragraph", content: [{ type: "text", text: "Bring one question." }] },
      ],
    },
    scheduledAt: "2026-12-24T10:00:00.000Z",
  };

  it("writes the time in words with its time zone instead of an ISO string", async () => {
    const described = await describeProposal("createPost", context({ body }));
    expect(described).toMatchObject({
      kind: "described",
      summary: 'schedule the post "Monday call" for 24 December 2026 at 10:00 UTC',
    });
    if (described.kind !== "described") return;
    expect(described.diff).toContainEqual({
      label: "Publish at",
      before: null,
      after: "24 December 2026 at 10:00 UTC",
    });
  });

  it("shows a short preview of the post body", async () => {
    const described = await describeProposal("createPost", context({ body }));
    if (described.kind !== "described") throw new Error("not described");
    expect(described.diff).toContainEqual({
      label: "Post",
      before: null,
      after: "See you Monday. Bring one question.",
    });
  });

  it("publishes right away when no time is given and reads a plain text body", async () => {
    const described = await describeProposal(
      "createPost",
      context({ body: { title: "Now", body: "Plain words" } }),
    );
    expect(described).toMatchObject({ kind: "described", summary: 'publish the post "Now"' });
    if (described.kind !== "described") return;
    expect(described.diff).toContainEqual({ label: "Post", before: null, after: "Plain words" });
  });
});
