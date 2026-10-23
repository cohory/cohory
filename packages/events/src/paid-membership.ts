import {
  paidMembershipChanges,
  paidMembershipEventsTopic,
  paidMembershipRecipientsPerEvent,
  type PaidMembershipEvent,
} from "@cohory/payments";
import type { SendOptions } from "pg-boss";
import { z } from "zod";

import { UnknownOutboxTopicError, type OutboxPublisher } from "./outbox";

export const notificationsPaidMembershipJob = "notifications.paid-membership";

const communityFields = {
  noticeId: z.uuid(),
  communityId: z.uuid(),
  communitySlug: z.string().min(1).max(200),
  communityName: z.string().min(1).max(200),
};

export const paidMembershipEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("paid_membership.changed"),
    payload: z.strictObject({
      ...communityFields,
      actorId: z.uuid(),
      change: z.enum(paidMembershipChanges),
      supportContact: z.string().max(320).nullable(),
      portalLoginUrl: z.url().max(2048).nullable(),
      recipients: z
        .array(z.strictObject({ userId: z.uuid(), endsAt: z.iso.datetime().nullable() }).readonly())
        .min(1)
        .max(paidMembershipRecipientsPerEvent)
        .readonly(),
    }),
  }),
  z.strictObject({
    type: z.literal("payments.fee_clear_required"),
    payload: z.strictObject({ ...communityFields, ownerId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal("payments.payment_disputed"),
    payload: z.strictObject({
      ...communityFields,
      ownerId: z.uuid(),
      amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      currency: z.string().regex(/^[a-z]{3}$/),
    }),
  }),
  z.strictObject({
    type: z.literal("payments.paid_member_joined"),
    payload: z.strictObject({
      ...communityFields,
      ownerId: z.uuid(),
      userId: z.uuid(),
      priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
      currency: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .nullable()
        .default(null),
      interval: z.enum(["month", "year"]).nullable().default(null),
    }),
  }),
  z.strictObject({
    type: z.literal("payments.paid_member_canceled"),
    payload: z.strictObject({
      ...communityFields,
      ownerId: z.uuid(),
      userId: z.uuid(),
      endsAt: z.iso.datetime().nullable(),
    }),
  }),
  z.strictObject({
    type: z.literal("payments.member_payment_failed"),
    payload: z.strictObject({
      ...communityFields,
      ownerId: z.uuid(),
      userId: z.uuid(),
      amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      currency: z.string().regex(/^[a-z]{3}$/),
      attempt: z.int().min(1).max(100),
      nextAttemptAt: z.iso.datetime().nullable(),
    }),
  }),
  z.strictObject({
    type: z.literal("payments.duplicate_refunded"),
    payload: z.strictObject({
      ...communityFields,
      userId: z.uuid(),
      amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      currency: z.string().regex(/^[a-z]{3}$/),
    }),
  }),
]);

export const paidMembershipEventsJobPayloadSchema = z.strictObject({
  events: z.array(paidMembershipEventSchema).min(1).max(20),
});

export type PaidMembershipEventsJobPayload = z.infer<typeof paidMembershipEventsJobPayloadSchema>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesPaidMembershipEvent: Same<
  z.infer<typeof paidMembershipEventSchema>,
  PaidMembershipEvent
> = true;
void schemaMatchesPaidMembershipEvent;

export interface PaidMembershipJobQueue {
  createQueue(name: string): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
}

export function createPaidMembershipEventsPublisher(
  getQueue: () => Promise<PaidMembershipJobQueue>,
): OutboxPublisher {
  let ready: Promise<PaidMembershipJobQueue> | undefined;
  function queue(): Promise<PaidMembershipJobQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(notificationsPaidMembershipJob);
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (row) => {
    if (row.topic !== paidMembershipEventsTopic) {
      throw new UnknownOutboxTopicError(row.topic);
    }
    const payload = paidMembershipEventsJobPayloadSchema.parse(row.payload);
    await (
      await queue()
    ).send(notificationsPaidMembershipJob, payload, {
      id: row.id,
      singletonKey: row.id,
      retryLimit: 5,
      retryBackoff: true,
    });
  };
}
