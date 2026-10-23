import { paidMembershipEventsTopic } from "@cohory/payments";
import { describe, expect, it, vi } from "vitest";

import { createOutboxDispatcher } from "./dispatch";
import { UnknownOutboxTopicError, type PendingOutboxRow } from "./outbox";
import {
  createPaidMembershipEventsPublisher,
  notificationsPaidMembershipJob,
  paidMembershipEventsJobPayloadSchema,
} from "./paid-membership";

const communityId = "0192f2a4-0000-7000-8000-000000000001";
const actorId = "0192f2a4-0000-7000-8000-000000000002";
const userId = "0192f2a4-0000-7000-8000-000000000003";
const rowId = "0192f2a4-0000-7000-8000-0000000000aa";

const changed = {
  type: "paid_membership.changed",
  payload: {
    noticeId: "0192f2a4-0000-7000-8000-0000000000bb",
    communityId,
    communitySlug: "makers",
    communityName: "Makers",
    actorId,
    change: "archived_ending",
    supportContact: null,
    portalLoginUrl: null,
    recipients: [{ userId, endsAt: "2026-11-18T10:00:00.000Z" }],
  },
};

function row(payload: unknown, topic = paidMembershipEventsTopic): PendingOutboxRow {
  return { id: rowId, communityId: null, topic, payload, attempts: 0 };
}

function fakeQueue() {
  return {
    createQueue: vi.fn(async () => undefined),
    send: vi.fn(async () => "job-id"),
  };
}

describe("paid membership events publisher", () => {
  it("routes paid_membership.events rows to notifications.paid-membership", async () => {
    const queue = fakeQueue();
    const dispatch = createOutboxDispatcher({
      [paidMembershipEventsTopic]: createPaidMembershipEventsPublisher(async () => queue),
    });

    await dispatch(row({ events: [changed] }));

    expect(queue.send).toHaveBeenCalledWith(
      notificationsPaidMembershipJob,
      { events: [changed] },
      expect.objectContaining({ id: rowId, singletonKey: rowId, retryLimit: 5 }),
    );
  });

  it("publishes one job per outbox row when the relay replays it", async () => {
    const queue = fakeQueue();
    const publish = createPaidMembershipEventsPublisher(async () => queue);

    await publish(row({ events: [changed] }));
    await publish(row({ events: [changed] }));

    expect(queue.createQueue).toHaveBeenCalledOnce();
    for (const nth of [1, 2]) {
      expect(queue.send).toHaveBeenNthCalledWith(
        nth,
        notificationsPaidMembershipJob,
        { events: [changed] },
        expect.objectContaining({ id: rowId, singletonKey: rowId }),
      );
    }
  });

  it("accepts the owner notice to clear the fee", () => {
    const parsed = paidMembershipEventsJobPayloadSchema.parse({
      events: [
        {
          type: "payments.fee_clear_required",
          payload: {
            noticeId: "0192f2a4-0000-7000-8000-0000000000cc",
            communityId,
            communitySlug: "makers",
            communityName: "Makers",
            ownerId: userId,
          },
        },
      ],
    });
    expect(parsed.events).toHaveLength(1);
  });

  it("accepts the owner notice about a disputed payment and rejects a fractional amount", () => {
    const disputed = {
      type: "payments.payment_disputed",
      payload: {
        noticeId: "0192f2a4-0000-7000-8000-0000000000cd",
        communityId,
        communitySlug: "makers",
        communityName: "Makers",
        ownerId: userId,
        amountMinor: 4900,
        currency: "usd",
      },
    };
    expect(paidMembershipEventsJobPayloadSchema.parse({ events: [disputed] }).events).toHaveLength(
      1,
    );
    expect(() =>
      paidMembershipEventsJobPayloadSchema.parse({
        events: [{ ...disputed, payload: { ...disputed.payload, amountMinor: 49.5 } }],
      }),
    ).toThrow();
  });

  it("rejects malformed payloads, more than 20 events, and other topics", async () => {
    const publish = createPaidMembershipEventsPublisher(async () => fakeQueue());
    await expect(publish(row({ events: [{ type: "paid_membership.changed" }] }))).rejects.toThrow();
    await expect(
      publish(row({ events: Array.from({ length: 21 }, () => changed) })),
    ).rejects.toThrow();
    await expect(publish(row({ events: [changed] }, "post.events"))).rejects.toBeInstanceOf(
      UnknownOutboxTopicError,
    );
  });
});
