import { z } from "zod";

export const domainEventsTopic = "domain_events";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });

export const memberRemovalReasonSchema = z.enum(["left", "removed", "banned"]);

export type MemberRemovalReason = z.infer<typeof memberRemovalReasonSchema>;

export const domainEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("member.joined"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      role: z.enum(["owner", "admin", "moderator", "member"]),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("member.removed"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      status: z.enum(["pending", "removed", "banned"]),
      reason: memberRemovalReasonSchema.optional(),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("lesson.completed"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      courseId: id,
      lessonId: id,
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("event.rsvp_changed"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      eventId: id,
      occurrenceId: id,
      status: z.enum(["going", "not_going"]),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("subscription.activated"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      subscriptionId: id,
      planId: id.nullable(),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("review.created"),
    payload: z.strictObject({
      communityId: id,
      reviewId: id,
      authorId: id,
      rating: z.int().min(1).max(5),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("review.updated"),
    payload: z.strictObject({
      communityId: id,
      reviewId: id,
      authorId: id,
      rating: z.int().min(1).max(5),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("review.deleted"),
    payload: z.strictObject({ communityId: id, reviewId: id, occurredAt: instant }),
  }),
  z.strictObject({
    type: z.literal("review.hidden"),
    payload: z.strictObject({
      communityId: id,
      reviewId: id,
      reason: z.enum(["spam", "abuse", "personal_data", "off_topic"]),
      occurredAt: instant,
    }),
  }),
  z.strictObject({
    type: z.literal("subscription.ended"),
    payload: z.strictObject({
      communityId: id,
      userId: id,
      subscriptionId: id,
      planId: id.nullable(),
      occurredAt: instant,
    }),
  }),
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventName = DomainEvent["type"];

export const domainEventsPayloadSchema = z.strictObject({
  events: z.array(domainEventSchema).min(1).max(50),
});
