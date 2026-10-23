import { creatorMoments, type CreatorMoment } from "@cohory/db/schema";
import { postEventsTopic } from "@cohory/posts";
import type { SendOptions } from "pg-boss";
import { z } from "zod";

import { courseEventsPayloadSchema, courseEventsTopic } from "./course-events";
import { domainEventsPayloadSchema, domainEventsTopic, type DomainEventName } from "./domain";
import type { OutboxPublisher, PendingOutboxRow } from "./outbox";
import { postEventsJobPayloadSchema } from "./schema";

export const feedbackMomentsJob = "feedback.moments";

export const feedbackMomentPayloadSchema = z.strictObject({
  communityId: z.uuid(),
  moment: z.enum(creatorMoments),
});

export type FeedbackMomentPayload = z.infer<typeof feedbackMomentPayloadSchema>;

export interface FeedbackMomentsQueue {
  createQueue(name: string): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
}

const domainMoments: Partial<Record<DomainEventName, CreatorMoment>> = {
  "subscription.activated": "first_paid_member",
};

function unique(moments: readonly FeedbackMomentPayload[]): FeedbackMomentPayload[] {
  const seen = new Map<string, FeedbackMomentPayload>();
  for (const moment of moments) {
    seen.set(`${moment.communityId}:${moment.moment}`, moment);
  }
  return [...seen.values()];
}

export function momentsOf(row: PendingOutboxRow): FeedbackMomentPayload[] {
  if (row.topic === postEventsTopic) {
    return unique(
      postEventsJobPayloadSchema
        .parse(row.payload)
        .events.filter((event) => event.type === "post.created")
        .map((event) => ({ communityId: event.payload.communityId, moment: "first_post" })),
    );
  }
  if (row.topic === courseEventsTopic) {
    return unique(
      courseEventsPayloadSchema.parse(row.payload).events.map((event) => ({
        communityId: event.payload.communityId,
        moment: "first_course",
      })),
    );
  }
  if (row.topic === domainEventsTopic) {
    return unique(
      domainEventsPayloadSchema.parse(row.payload).events.flatMap((event) => {
        const moment = domainMoments[event.type];
        return moment ? [{ communityId: event.payload.communityId, moment }] : [];
      }),
    );
  }
  return [];
}

export function createFeedbackMomentsPublisher(
  getQueue: () => Promise<FeedbackMomentsQueue>,
  enabled: () => boolean,
): OutboxPublisher {
  let ready: Promise<FeedbackMomentsQueue> | undefined;
  function queue(): Promise<FeedbackMomentsQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(feedbackMomentsJob);
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (row) => {
    if (!enabled()) {
      return;
    }
    const moments = momentsOf(row);
    if (moments.length === 0) {
      return;
    }
    const jobs = await queue();
    for (const moment of moments) {
      await jobs.send(feedbackMomentsJob, moment, {
        singletonKey: `${moment.communityId}:${moment.moment}`,
        retryLimit: 3,
        retryBackoff: true,
      });
    }
  };
}
