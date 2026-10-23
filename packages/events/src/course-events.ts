import { z } from "zod";

// Lives here rather than in @cohory/courses because courses' test dependencies already reach this
// package through notifications, so courses cannot be a dependency of it.
export const courseEventsTopic = "course_events";

export const courseEventSchema = z.strictObject({
  type: z.literal("course.published"),
  payload: z.strictObject({
    communityId: z.uuid(),
    courseId: z.uuid(),
    occurredAt: z.iso.datetime({ offset: true }),
  }),
});

export type CourseEvent = z.infer<typeof courseEventSchema>;

export const courseEventsPayloadSchema = z.strictObject({
  events: z.array(courseEventSchema).min(1).max(50),
});
