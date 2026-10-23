import { describe, expect, it } from "vitest";

import { composeCommunity, isWeeklyDigestDue, moneySummary, type ComposeInput } from "./compose";

const mondayNineBerlin = new Date("2026-10-26T08:00:00Z");

describe("isWeeklyDigestDue", () => {
  it("is due on Monday at the digest hour in the member's time zone", () => {
    expect(
      isWeeklyDigestDue({
        at: mondayNineBerlin,
        timeZone: "Europe/Berlin",
        digestHour: 9,
        lastSentAt: null,
      }),
    ).toBe(true);
  });

  it("is not due at another hour or on another day", () => {
    const base = { timeZone: "Europe/Berlin", digestHour: 9, lastSentAt: null };
    expect(isWeeklyDigestDue({ ...base, at: new Date("2026-10-26T09:00:00Z") })).toBe(false);
    expect(isWeeklyDigestDue({ ...base, at: new Date("2026-10-27T08:00:00Z") })).toBe(false);
  });

  it("is not due again within six days of the last digest", () => {
    const base = { at: mondayNineBerlin, timeZone: "Europe/Berlin", digestHour: 9 };
    expect(isWeeklyDigestDue({ ...base, lastSentAt: new Date("2026-10-26T08:00:00Z") })).toBe(
      false,
    );
    expect(isWeeklyDigestDue({ ...base, lastSentAt: new Date("2026-10-19T08:00:00Z") })).toBe(true);
  });
});

const input: ComposeInput = {
  appUrl: "https://cohory.test",
  timeZone: "America/New_York",
  community: { slug: "makers", name: "Makers" },
  activity: {
    newPostCount: 5,
    topPosts: [
      { id: "p1", title: "Show your workbench", excerpt: "First line\nSecond", commentCount: 4 },
      { id: "p2", title: null, excerpt: "A post without a title", commentCount: 0 },
    ],
    events: [
      {
        id: "o1",
        eventSlug: "studio",
        title: "Studio hours",
        startsAt: new Date("2026-10-29T22:00:00Z"),
      },
    ],
    progress: {
      courseSlug: "wheel",
      courseTitle: "Wheel basics",
      lessonSlug: "centering",
      lessonTitle: "Centering",
      percent: 40,
    },
  },
  members: { count: 2, names: ["Jamie", "Taylor"] },
  money: null,
};

describe("composeCommunity", () => {
  it("links posts, events, and the next lesson and formats times in the member's zone", () => {
    const digest = composeCommunity(input);

    expect(digest.url).toBe("https://cohory.test/c/makers");
    expect(digest.topPosts).toEqual([
      {
        title: "Show your workbench",
        firstLine: "First line",
        commentCount: 4,
        url: "https://cohory.test/c/makers/posts/p1",
      },
      {
        title: "A post without a title",
        firstLine: "",
        commentCount: 0,
        url: "https://cohory.test/c/makers/posts/p2",
      },
    ]);
    expect(digest.events).toEqual([
      {
        title: "Studio hours",
        when: "Thursday, October 29 at 6:00 PM",
        day: "Thursday",
        url: "https://cohory.test/c/makers/calendar/studio/o1",
      },
    ]);
    expect(digest.progress).toEqual({
      text: "You are 40% through Wheel basics. Next: Centering.",
      url: "https://cohory.test/c/makers/classroom/wheel/centering",
    });
    expect(digest.ownerSummary).toBeNull();
  });

  it("adds the paid membership line for owners only when something happened", () => {
    expect(moneySummary({ joined: 0, canceled: 0 })).toBeNull();
    expect(moneySummary({ joined: 2, canceled: 1 })).toBe(
      "Paid memberships this week: 2 new paying members, 1 cancellation.",
    );
    expect(composeCommunity({ ...input, money: { joined: 1, canceled: 0 } }).ownerSummary).toBe(
      "Paid memberships this week: 1 new paying member.",
    );
  });
});
