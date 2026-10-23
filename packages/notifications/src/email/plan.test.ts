import { describe, expect, it } from "vitest";

import { resolvePreferences, type NotificationPreferences } from "../preferences";
import {
  digestMaxItems,
  immediateHoldMs,
  isDigestDue,
  localHour,
  planEmails,
  type PendingNotification,
} from "./plan";

const now = new Date("2026-10-18T08:05:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

let next = 0;
function pending(
  type: PendingNotification["type"],
  createdAt: Date = minutesAgo(5),
  readAt: Date | null = null,
  extra: Partial<PendingNotification> = {},
): PendingNotification {
  next += 1;
  return { id: `n${next}`, type, createdAt, readAt, communityId: "c1", postId: null, ...extra };
}

const defaults = resolvePreferences([], null);

function prefs(overrides: Partial<NotificationPreferences>): NotificationPreferences {
  return { ...defaults, ...overrides };
}

const ids = (items: readonly PendingNotification[]) => items.map((item) => item.id);
const groups = (items: readonly (readonly PendingNotification[])[]) => items.map(ids);

describe("localHour", () => {
  it("reads the hour in the given time zone", () => {
    expect(localHour(new Date("2026-10-18T08:05:00Z"), "UTC")).toBe(8);
    expect(localHour(new Date("2026-10-18T08:05:00Z"), "Europe/Berlin")).toBe(10);
    expect(localHour(new Date("2026-10-18T23:30:00Z"), "Asia/Tokyo")).toBe(8);
  });
});

describe("isDigestDue", () => {
  it("is due at the chosen local hour when no digest went out in the last 20 hours", () => {
    expect(isDigestDue(now, { digestHour: 8, timeZone: "UTC" }, null)).toBe(true);
    expect(isDigestDue(now, { digestHour: 8, timeZone: "UTC" }, minutesAgo(21 * 60))).toBe(true);
  });

  it("is not due at another hour or twice in the same morning", () => {
    expect(isDigestDue(now, { digestHour: 9, timeZone: "UTC" }, null)).toBe(false);
    expect(isDigestDue(now, { digestHour: 8, timeZone: "UTC" }, minutesAgo(5))).toBe(false);
  });

  it("follows the member's time zone", () => {
    expect(isDigestDue(now, { digestHour: 10, timeZone: "Europe/Berlin" }, null)).toBe(true);
    expect(isDigestDue(now, { digestHour: 8, timeZone: "Europe/Berlin" }, null)).toBe(false);
  });
});

describe("planEmails", () => {
  it("sends immediate types in the immediate pass and leaves daily ones for the digest", () => {
    const mention = pending("mention");
    const comment = pending("comment_on_post");

    const plan = planEmails({
      pass: "immediate",
      pending: [mention, comment],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(groups(plan.immediate)).toEqual([[mention.id]]);
    expect(plan.digest).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("skips types whose email is off and notifications already read in the app", () => {
    const reply = pending("reply");
    const readMention = pending("mention", minutesAgo(2), minutesAgo(1));

    const plan = planEmails({
      pass: "immediate",
      pending: [reply, readMention],
      preferences: prefs({
        types: [
          { type: "mention", inApp: true, email: "immediate" },
          { type: "reply", inApp: true, email: "off" },
          { type: "comment_on_post", inApp: true, email: "daily" },
        ],
      }),
      lastDigestAt: null,
      now,
    });

    expect(plan.immediate).toEqual([]);
    expect(ids(plan.skip)).toEqual([reply.id, readMention.id]);
  });

  it("still emails a type whose in-app notification is off", () => {
    const mention = pending("mention");

    const plan = planEmails({
      pass: "immediate",
      pending: [mention],
      preferences: prefs({
        types: [
          { type: "mention", inApp: false, email: "immediate" },
          { type: "reply", inApp: true, email: "immediate" },
          { type: "comment_on_post", inApp: true, email: "daily" },
        ],
      }),
      lastDigestAt: null,
      now,
    });

    expect(groups(plan.immediate)).toEqual([[mention.id]]);
  });

  it("skips immediate notifications older than a day instead of sending them late", () => {
    const stale = pending("mention", minutesAgo(25 * 60));

    const plan = planEmails({
      pass: "immediate",
      pending: [stale],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(ids(plan.skip)).toEqual([stale.id]);
  });

  it("holds a right away email for a few minutes before sending it", () => {
    const fresh = pending("mention", minutesAgo(1));

    const plan = planEmails({
      pass: "immediate",
      pending: [fresh],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(immediateHoldMs).toBe(3 * 60_000);
    expect(plan).toEqual({ immediate: [], digest: [], skip: [] });
  });

  it("merges every pending update on one post once the oldest has waited", () => {
    const post = { postId: "p1" };
    const mention = pending("mention", minutesAgo(4), null, post);
    const reply = pending("reply", minutesAgo(1), null, post);
    const other = pending("reply", minutesAgo(1), null, { postId: "p2" });

    const plan = planEmails({
      pass: "immediate",
      pending: [reply, other, mention],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(groups(plan.immediate)).toEqual([[mention.id, reply.id]]);
    expect(plan.skip).toEqual([]);
  });

  it("merges join requests per community and keeps other notices apart", () => {
    const first = pending("join_request", minutesAgo(5), null, { communityId: "c1" });
    const second = pending("join_request", minutesAgo(4), null, { communityId: "c1" });
    const elsewhere = pending("join_request", minutesAgo(4), null, { communityId: "c2" });
    const approved = pending("join_request_approved", minutesAgo(4), null, { communityId: "c1" });

    const plan = planEmails({
      pass: "immediate",
      pending: [first, second, elsewhere, approved],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(groups(plan.immediate)).toEqual([[first.id, second.id], [elsewhere.id], [approved.id]]);
  });

  it("follows a notification's own email mode over the type preference", () => {
    const request = pending("join_request", minutesAgo(5), null, { emailMode: "daily" });

    const immediatePlan = planEmails({
      pass: "immediate",
      pending: [request],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });
    const digestPlan = planEmails({
      pass: "digest",
      pending: [request],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(immediatePlan.immediate).toEqual([]);
    expect(ids(digestPlan.digest)).toEqual([request.id]);
  });

  it("batches daily notifications newest first when the digest is due", () => {
    const older = pending("comment_on_post", minutesAgo(600));
    const newer = pending("comment_on_post", minutesAgo(30));
    const mention = pending("mention");

    const plan = planEmails({
      pass: "digest",
      pending: [older, newer, mention],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(ids(plan.digest)).toEqual([newer.id, older.id]);
    expect(plan.immediate).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("holds daily notifications until the digest hour", () => {
    const comment = pending("comment_on_post");

    const plan = planEmails({
      pass: "digest",
      pending: [comment],
      preferences: prefs({ digestHour: 18 }),
      lastDigestAt: null,
      now,
    });

    expect(plan).toEqual({ immediate: [], digest: [], skip: [] });
  });

  it("drops daily notifications older than two days and caps the digest", () => {
    const expired = pending("comment_on_post", minutesAgo(49 * 60));
    const many = Array.from({ length: digestMaxItems + 2 }, (_, i) =>
      pending("comment_on_post", minutesAgo(i + 1)),
    );

    const plan = planEmails({
      pass: "digest",
      pending: [expired, ...many],
      preferences: defaults,
      lastDigestAt: null,
      now,
    });

    expect(plan.digest).toHaveLength(digestMaxItems);
    expect(ids(plan.skip)).toEqual([expired.id, ...ids(many.slice(digestMaxItems))]);
  });
});
