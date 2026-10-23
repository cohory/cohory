import { ForbiddenError } from "@cohory/authz";
import { describe, expect, it, vi } from "vitest";

import {
  createWeeklyDigestSource,
  type WeeklyDigestServices,
} from "./jobs/notifications-weekly-digest";

const now = new Date("2026-10-26T08:00:00Z");
const since = new Date("2026-10-19T08:00:00Z");
const input = { userId: "u1", communityId: "c1", since, now };

function post(id: string, createdAt: string, title: string | null = `Post ${id}`) {
  return { id, title, excerpt: `About ${id}`, commentCount: 2, createdAt: new Date(createdAt) };
}

function services(feed: ReturnType<typeof post>[]) {
  const listFeed = vi.fn<WeeklyDigestServices["posts"]["listFeed"]>(async (_actor, _id, query) => ({
    data: query?.sort === "top" ? feed.slice(0, 1) : feed,
  }));
  const listOccurrences = vi.fn<WeeklyDigestServices["calendar"]["listOccurrences"]>(async () => [
    {
      id: "o1",
      startsAt: new Date("2026-10-27T18:00:00Z"),
      canceledAt: new Date("2026-10-20T00:00:00Z"),
      event: { slug: "canceled", title: "Canceled" },
    },
    {
      id: "o2",
      startsAt: new Date("2026-10-28T18:00:00Z"),
      canceledAt: null,
      event: { slug: "studio", title: "Studio hours" },
    },
  ]);
  const getContinueLearning = vi.fn<WeeklyDigestServices["courses"]["getContinueLearning"]>(
    async () => ({
      course: { id: "k1", slug: "wheel", title: "Wheel basics" },
      lesson: { id: "l1", slug: "centering", title: "Centering" },
      progressPercent: 40,
    }),
  );
  return {
    listFeed,
    listOccurrences,
    getContinueLearning,
    source: createWeeklyDigestSource({
      posts: { listFeed },
      calendar: { listOccurrences },
      courses: { getContinueLearning },
    }),
  };
}

describe("weekly digest source", () => {
  it("counts this week's posts and keeps only this week's top posts, read as the member", async () => {
    const fake = services([
      post("p1", "2026-10-25T10:00:00Z"),
      post("p2", "2026-10-21T10:00:00Z"),
      post("p3", "2026-10-10T10:00:00Z"),
    ]);
    fake.listFeed.mockImplementation(async (_actor, _id, query) => ({
      data:
        query?.sort === "top"
          ? [
              post("old", "2026-09-01T10:00:00Z"),
              post("p2", "2026-10-21T10:00:00Z"),
              post("p4", "2026-10-22T10:00:00Z"),
              post("p5", "2026-10-23T10:00:00Z"),
              post("p6", "2026-10-24T10:00:00Z"),
            ]
          : [
              post("p1", "2026-10-25T10:00:00Z"),
              post("p2", "2026-10-21T10:00:00Z"),
              post("p3", "2026-10-10T10:00:00Z"),
            ],
    }));

    const feed = await fake.source.feed(input);

    expect(feed).toEqual({
      newPostCount: 2,
      topPosts: ["p2", "p4", "p5"].map((id) => ({
        id,
        title: `Post ${id}`,
        excerpt: `About ${id}`,
        commentCount: 2,
      })),
    });
    expect(fake.listFeed.mock.calls[0]?.[0]).toEqual({
      kind: "user",
      userId: "u1",
      platformAdmin: false,
    });
  });

  it("stops after the post count when the community was quiet", async () => {
    const fake = services([post("p1", "2026-10-25T10:00:00Z")]);

    expect(await fake.source.feed(input)).toEqual({ newPostCount: 1, topPosts: [] });
    expect(fake.listFeed).toHaveBeenCalledTimes(1);
  });

  it("returns no feed when the member may not read the community", async () => {
    const fake = services([]);
    fake.listFeed.mockRejectedValue(new ForbiddenError("read", "community"));

    expect(await fake.source.feed(input)).toBeNull();
  });

  it("passes on errors other than a denied read", async () => {
    const fake = services([]);
    fake.listFeed.mockRejectedValue(new Error("database down"));

    await expect(fake.source.feed(input)).rejects.toThrow("database down");
  });

  it("reads the next events and course progress as the member", async () => {
    const fake = services([]);

    expect(await fake.source.extras(input)).toEqual({
      events: [
        {
          id: "o2",
          eventSlug: "studio",
          title: "Studio hours",
          startsAt: new Date("2026-10-28T18:00:00Z"),
        },
      ],
      progress: {
        courseSlug: "wheel",
        courseTitle: "Wheel basics",
        lessonSlug: "centering",
        lessonTitle: "Centering",
        percent: 40,
      },
    });
    expect(fake.listOccurrences.mock.calls[0]?.[2]).toEqual({
      from: now,
      to: new Date("2026-11-02T08:00:00Z"),
    });
  });
});
