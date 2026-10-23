import type { Leaderboard } from "@cohory/gamification";
import type { MemberProfile, MemberSummary } from "@cohory/members";
import { describe, expect, it } from "vitest";

import { applyAuthorLevels } from "./author-levels";
import {
  authorLevelFor,
  earningLine,
  levelOptions,
  toActivityItems,
  toLeaderboardView,
  toMemberListItems,
  toProfileView,
} from "./views";

const userId = "0192f2a4-0000-7000-8000-0000000000aa";
const joinedAt = new Date("2026-10-01T10:00:00.000Z");

const summary: MemberSummary = {
  userId,
  name: "Ada Lovelace",
  image: null,
  username: "ada",
  role: "owner",
  joinedAt,
  points: 42,
  level: 3,
  levelName: "Regular",
  bio: "Teaches yoga.",
};

const off: MemberSummary = { ...summary, points: null, level: null, levelName: null };

function profile(member: MemberSummary): MemberProfile {
  return {
    ...member,
    recentActivity: {
      posts: [
        {
          id: "p1",
          title: "Hello",
          excerpt: "First post",
          createdAt: new Date("2026-10-02T00:00:00Z"),
        },
      ],
      comments: [
        {
          id: "c1",
          postId: "p9",
          excerpt: "Nice",
          createdAt: new Date("2026-10-03T00:00:00Z"),
        },
      ],
    },
  };
}

describe("member cards", () => {
  it("maps a member summary to card props with a profile link", () => {
    expect(toMemberListItems("yoga", [summary], new Date("2026-11-01T10:00:00.000Z"))).toEqual([
      {
        href: `/c/yoga/members/${userId}`,
        member: {
          userId,
          name: "Ada Lovelace",
          username: "ada",
          image: null,
          role: "owner",
          level: 3,
          levelName: "Regular",
          points: 42,
          joinedAt: "2026-10-01T10:00:00.000Z",
          bio: "Teaches yoga.",
          isNew: false,
        },
      },
    ]);
  });

  it("marks members who joined in the last 14 days as new", () => {
    const at = (iso: string) => toMemberListItems("yoga", [summary], new Date(iso))[0]?.member;
    expect(at("2026-10-15T09:59:59.999Z")?.isNew).toBe(true);
    expect(at("2026-10-15T10:00:00.000Z")?.isNew).toBe(false);
  });

  it("fills neutral level fields when gamification is off", () => {
    const [item] = toMemberListItems("yoga", [off]);
    expect(item?.member).toMatchObject({ level: 1, levelName: null, points: 0 });
  });

  it("offers nine level filters with custom names, and none when gamification is off", () => {
    const names = ["Seed", "Sprout"];
    const options = levelOptions({ enabled: true, levelNames: names });
    expect(options).toHaveLength(9);
    expect(options[0]).toEqual({ level: 1, name: "Seed" });
    expect(options[2]).toEqual({ level: 3, name: null });
    expect(levelOptions({ enabled: false, levelNames: names })).toEqual([]);
  });
});

describe("profile view", () => {
  it("shows level progress to the next threshold", () => {
    const view = toProfileView("yoga", profile(summary));
    expect(view.gamificationEnabled).toBe(true);
    expect(view.nextLevelAt).toBe(75);
    expect(view.bio).toBe("Teaches yoga.");
  });

  it("hides levels and progress when gamification is off", () => {
    const view = toProfileView("yoga", profile(off));
    expect(view.gamificationEnabled).toBe(false);
    expect(view.nextLevelAt).toBeNull();
    expect(view.member.points).toBe(0);
  });

  it("lists recent posts and comments newest first, linking to the post", () => {
    expect(toActivityItems("yoga", profile(summary).recentActivity)).toEqual([
      {
        type: "comment",
        title: null,
        excerpt: "Nice",
        href: "/c/yoga/posts/p9#comments",
        createdAt: "2026-10-03T00:00:00.000Z",
      },
      {
        type: "post",
        title: "Hello",
        excerpt: "First post",
        href: "/c/yoga/posts/p1",
        createdAt: "2026-10-02T00:00:00.000Z",
      },
    ]);
  });
});

describe("leaderboard view", () => {
  const entry = {
    rank: 1,
    userId,
    name: "Ada Lovelace",
    image: null,
    username: "ada",
    points: 5,
    level: 1,
    levelName: "Level 1",
  };

  it("passes the disabled state through", () => {
    expect(toLeaderboardView("yoga", { status: "disabled" })).toEqual({ status: "disabled" });
  });

  it("maps entries and the viewer row", () => {
    const board: Leaderboard = {
      status: "enabled",
      window: "7d",
      since: new Date(),
      entries: [entry],
      viewer: { rank: 14, points: 1, totalPoints: 3, level: 1, levelName: "Newcomer" },
      ladder: [],
      earning: { lessons: false, events: false },
    };
    expect(toLeaderboardView("yoga", board)).toMatchObject({
      status: "enabled",
      entries: [
        {
          rank: 1,
          points: 5,
          href: `/c/yoga/members/${userId}`,
          member: { userId, name: "Ada Lovelace", image: null, level: 1, levelName: null },
        },
      ],
      viewer: { rank: 14, points: 1 },
    });
  });

  it("gives the viewer's progress to the next level from all time points", () => {
    const board: Leaderboard = {
      status: "enabled",
      window: "7d",
      since: new Date(),
      entries: [],
      viewer: { rank: 3, points: 2, totalPoints: 12, level: 2, levelName: "Sprout" },
      ladder: [{ level: 2, name: "Level 2", minPoints: 10, members: 4, share: 40 }],
      earning: { lessons: false, events: false },
    };
    const view = toLeaderboardView("yoga", board);
    if (view.status !== "enabled") throw new Error("expected enabled");
    expect(view.progress).toEqual({ level: 2, name: "Sprout", points: 12, nextLevelAt: 30 });
    expect(view.ladder).toEqual([{ level: 2, name: null, minPoints: 10, share: 40 }]);
  });

  it("drops the viewer row when the viewer has no rank", () => {
    const board: Leaderboard = {
      status: "enabled",
      window: "all",
      since: null,
      entries: [],
      viewer: { rank: null, points: 0, totalPoints: 0, level: 1, levelName: "Newcomer" },
      ladder: [],
      earning: { lessons: false, events: false },
    };
    const view = toLeaderboardView("yoga", board);
    expect(view.status === "enabled" && view.viewer).toBeNull();
  });
});

describe("how points are earned", () => {
  it("names likes only by default", () => {
    expect(earningLine({ lessons: false, events: false })).toBe(
      "You earn 1 point for each like on your posts and comments.",
    );
  });

  it("adds finished lessons and attended events when the creator turned them on", () => {
    expect(earningLine({ lessons: true, events: false })).toBe(
      "You earn 1 point for each like on your posts and comments and each lesson you finish.",
    );
    expect(earningLine({ lessons: true, events: true })).toBe(
      "You earn 1 point for each like on your posts and comments, each lesson you finish, and each event you attend.",
    );
  });
});

describe("author levels on posts and comments", () => {
  it("names the level and defaults to level 1 without stats", () => {
    expect(authorLevelFor({ enabled: true, levelNames: ["Seed", "Sprout", "Regular"] }, 3)).toEqual(
      {
        level: 3,
        name: "Regular",
      },
    );
    expect(authorLevelFor({ enabled: true, levelNames: [] }, undefined)).toEqual({
      level: 1,
      name: null,
    });
  });

  it("returns no level when gamification is off", () => {
    expect(authorLevelFor({ enabled: false, levelNames: [] }, 3)).toBeNull();
  });

  it("attaches levels by author id and null for unknown authors", () => {
    const items = [
      { id: "a", author: { id: userId, name: "Ada" } },
      { id: "b", author: { id: "someone-else", name: "Bo" } },
    ];
    const levels = new Map([[userId, { level: 2, name: "Member" }]]);
    expect(applyAuthorLevels(items, levels).map((item) => item.author.level)).toEqual([
      { level: 2, name: "Member" },
      null,
    ]);
  });
});
