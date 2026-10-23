import { describe, expect, it } from "vitest";

import { paidMembershipEvents, paidMembershipRecipientsPerEvent } from "./events";

const base = {
  noticeId: "01900000-0000-7000-8000-0000000000aa",
  communityId: "01900000-0000-7000-8000-000000000001",
  communitySlug: "makers",
  communityName: "Makers",
  actorId: "01900000-0000-7000-8000-000000000002",
  change: "archived_ending" as const,
  supportContact: null,
  portalLoginUrl: null,
};

function many(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `01900000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    endsAt: new Date("2026-11-18T10:00:00.000Z"),
  }));
}

describe("paidMembershipEvents", () => {
  it("splits 250 recipients into 3 events", () => {
    const events = paidMembershipEvents({ ...base, recipients: many(250) });
    expect(events).toHaveLength(3);
    expect(paidMembershipRecipientsPerEvent).toBe(100);
    const sizes = events.map((event) =>
      event.type === "paid_membership.changed" ? event.payload.recipients.length : 0,
    );
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("sends the end date as an ISO string and each person once", () => {
    const [first] = many(1);
    const events = paidMembershipEvents({
      ...base,
      recipients: [first ?? { userId: "", endsAt: null }, first ?? { userId: "", endsAt: null }],
    });
    expect(events).toEqual([
      {
        type: "paid_membership.changed",
        payload: {
          ...base,
          recipients: [{ userId: first?.userId, endsAt: "2026-11-18T10:00:00.000Z" }],
        },
      },
    ]);
  });

  it("makes no event when nobody pays", () => {
    expect(paidMembershipEvents({ ...base, recipients: [] })).toEqual([]);
  });
});
