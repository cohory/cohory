import { membershipEventsTopic, type MembershipEvent } from "@cohory/communities";
import type { SendOptions } from "pg-boss";
import { z } from "zod";

import { UnknownOutboxTopicError, type OutboxPublisher } from "./outbox";

export const notificationsMembershipJob = "notifications.membership";

export const membershipEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("join_request.created"),
    payload: z.strictObject({ communityId: z.uuid(), requestId: z.uuid(), userId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal("join_request.decided"),
    payload: z.strictObject({
      communityId: z.uuid(),
      requestId: z.uuid(),
      userId: z.uuid(),
      decidedBy: z.uuid(),
      status: z.enum(["approved", "declined"]),
    }),
  }),
  z.strictObject({
    type: z.literal("ownership.transferred"),
    payload: z.strictObject({
      communityId: z.uuid(),
      noticeId: z.uuid(),
      previousOwnerId: z.uuid(),
      newOwnerId: z.uuid(),
    }),
  }),
]);

function singletonKeyOf(event: MembershipEventsJobPayload["events"][number]): string {
  return event.type === "ownership.transferred"
    ? `${event.type}:${event.payload.noticeId}`
    : `${event.type}:${event.payload.requestId}`;
}

export const membershipEventsJobPayloadSchema = z.strictObject({
  events: z.array(membershipEventSchema).min(1).max(50),
});

export type MembershipEventsJobPayload = z.infer<typeof membershipEventsJobPayloadSchema>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesMembershipEvent: Same<
  z.infer<typeof membershipEventSchema>,
  MembershipEvent
> = true;
void schemaMatchesMembershipEvent;

export interface MembershipJobQueue {
  createQueue(name: string): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
}

export function createMembershipEventsPublisher(
  getQueue: () => Promise<MembershipJobQueue>,
): OutboxPublisher {
  let ready: Promise<MembershipJobQueue> | undefined;
  function queue(): Promise<MembershipJobQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(notificationsMembershipJob);
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (row) => {
    if (row.topic !== membershipEventsTopic) {
      throw new UnknownOutboxTopicError(row.topic);
    }
    const payload = membershipEventsJobPayloadSchema.parse(row.payload);
    const [first] = payload.events;
    await (
      await queue()
    ).send(notificationsMembershipJob, payload, {
      id: row.id,
      singletonKey: first ? singletonKeyOf(first) : row.id,
      singletonSeconds: 60,
      retryLimit: 5,
      retryBackoff: true,
    });
  };
}
