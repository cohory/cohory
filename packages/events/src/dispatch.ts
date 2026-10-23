import { parseEdition } from "@cohory/config/platform";
import { getDb, getQueueDatabase } from "@cohory/db";
import {
  postEventsTopic,
  type CommittedPostEvents,
  type PostEvent,
  type PostEventName,
} from "@cohory/posts";
import { PgBoss, type SendOptions } from "pg-boss";
import { z } from "zod";

import { membershipEventsTopic } from "@cohory/communities";
import { getPlatformConfig } from "@cohory/config/platform";
import { paidMembershipEventsTopic } from "@cohory/payments";

import { courseEventsPayloadSchema, courseEventsTopic } from "./course-events";
import { createCreatorsInviteTrigger } from "./creators-invite";

import { domainEventsPayloadSchema, domainEventsTopic, type DomainEventName } from "./domain";
import { createMembershipEventsPublisher } from "./membership";
import { createFeedbackMomentsPublisher } from "./moments";
import { createPaidMembershipEventsPublisher } from "./paid-membership";
import {
  relayOutbox,
  UnknownOutboxTopicError,
  type OutboxPublisher,
  type RelayOptions,
  type RelayResult,
} from "./outbox";
import { postEventsJobPayloadSchema, type PostEventsJobPayload } from "./schema";
import { createWebhookFanoutPublisher } from "./webhooks";

export const notificationsFanoutJob = "notifications.fanout";
export const gamificationPointsJob = "gamification.points";
export const postsMemberEmailJob = "posts.member-email";

export interface PostEventRoute {
  readonly queue: string;
  readonly accepts: ReadonlySet<PostEventName>;
  readonly retryLimit?: number;
}

export const postEventRoutes: readonly PostEventRoute[] = [
  {
    queue: notificationsFanoutJob,
    accepts: new Set([
      "post.created",
      "comment.created",
      "mention.created",
      "like.added",
      "report.created",
      "report.resolved",
      "post.deleted",
      "comment.deleted",
    ]),
  },
  {
    queue: gamificationPointsJob,
    accepts: new Set(["like.added", "like.removed", "post.deleted", "comment.deleted"]),
  },
  { queue: postsMemberEmailJob, accepts: new Set(["post.emailed"]), retryLimit: 0 },
];

export interface JobQueue {
  createQueue(name: string): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
}

export type PostEventsSender = (events: readonly PostEvent[], jobId: string) => Promise<void>;

export type PostEventsPublisher = (committed: CommittedPostEvents) => Promise<void>;

function singletonKey(event: PostEvent): string {
  switch (event.type) {
    case "post.created":
    case "post.deleted":
      return `${event.type}:${event.payload.postId}`;
    case "post.emailed":
      return `${event.type}:${event.payload.postId}:${event.payload.occurredAt}`;
    case "comment.created":
    case "comment.deleted":
      return `${event.type}:${event.payload.commentId}`;
    case "mention.created":
      return `${event.type}:${event.payload.subjectId}:${event.payload.mentionedUserId}`;
    case "like.added":
    case "like.removed":
      return `${event.type}:${event.payload.reactionId}`;
    case "report.created":
      return `${event.type}:${event.payload.reportId}`;
    case "report.resolved":
      return `${event.type}:${event.payload.commentId ?? event.payload.postId}:${event.payload.resolution}:${[...event.payload.reporterIds].sort().join(",")}`;
  }
}

export function createPostEventsSender(
  getQueue: () => Promise<JobQueue>,
  routes: readonly PostEventRoute[] = postEventRoutes,
): PostEventsSender {
  let ready: Promise<JobQueue> | undefined;
  function queue(): Promise<JobQueue> {
    ready ??= getQueue().then(async (q) => {
      for (const route of routes) {
        await q.createQueue(route.queue);
      }
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (events, jobId) => {
    if (events.length === 0) {
      return;
    }
    for (const route of routes) {
      const accepted = events.filter((event) => route.accepts.has(event.type));
      const [first] = accepted;
      if (!first) {
        continue;
      }
      const payload: PostEventsJobPayload = { events: accepted };
      await (
        await queue()
      ).send(route.queue, payload, {
        id: jobId,
        singletonKey: singletonKey(first),
        singletonSeconds: 60,
        retryLimit: route.retryLimit ?? 5,
        retryBackoff: true,
      });
    }
  };
}

export function createPostEventsOutboxPublisher(send: PostEventsSender): OutboxPublisher {
  return async (row) => {
    if (row.topic !== postEventsTopic) {
      throw new UnknownOutboxTopicError(row.topic);
    }
    const { events } = postEventsJobPayloadSchema.parse(row.payload);
    await send(events, row.id);
  };
}

export function createOutboxDispatcher(
  publishers: Readonly<Record<string, OutboxPublisher>>,
): OutboxPublisher {
  return async (row) => {
    const publish = publishers[row.topic];
    if (!publish) {
      throw new UnknownOutboxTopicError(row.topic);
    }
    await publish(row);
  };
}

export const notificationsDomainJob = "notifications.domain";
export const notificationsWelcomeJob = "notifications.welcome";
export const welcomeEmailDelaySeconds = 120;

export const welcomeJobPayloadSchema = z.strictObject({ communityId: z.uuid(), userId: z.uuid() });

const notifiedDomainEvents: ReadonlySet<DomainEventName> = new Set(["member.joined"]);

export function createDomainEventsPublisher(getQueue: () => Promise<JobQueue>): OutboxPublisher {
  let ready: Promise<JobQueue> | undefined;
  function queue(): Promise<JobQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(notificationsDomainJob);
      await q.createQueue(notificationsWelcomeJob);
      return q;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return async (row) => {
    if (row.topic !== domainEventsTopic) {
      throw new UnknownOutboxTopicError(row.topic);
    }
    const { events } = domainEventsPayloadSchema.parse(row.payload);
    const notified = events.filter((event) => notifiedDomainEvents.has(event.type));
    if (notified.length === 0) {
      return;
    }
    const jobs = await queue();
    await jobs.send(
      notificationsDomainJob,
      { events: notified },
      { id: row.id, singletonKey: row.id, retryLimit: 5, retryBackoff: true },
    );
    for (const event of notified) {
      if (event.type !== "member.joined" || event.payload.role === "owner") {
        continue;
      }
      const { communityId, userId } = event.payload;
      await jobs.send(
        notificationsWelcomeJob,
        { communityId, userId },
        {
          singletonKey: `welcome:${communityId}:${userId}`,
          startAfter: welcomeEmailDelaySeconds,
          retryLimit: 5,
          retryBackoff: true,
        },
      );
    }
  };
}

export function withWebhookFanout(
  primary: OutboxPublisher,
  fanout: OutboxPublisher,
): OutboxPublisher {
  return async (row) => {
    await primary(row);
    await fanout(row);
  };
}

export interface PublishFailureLog {
  error(line: string): void;
}

export function relayAfterCommit(
  relay: (ids: readonly string[]) => Promise<RelayResult>,
  log: PublishFailureLog = console,
): PostEventsPublisher {
  return async ({ outboxId, events }) => {
    const report = (name: string) =>
      log.error(
        JSON.stringify({
          level: "error",
          msg: "post events stay in the outbox for the relay job",
          name,
          outboxId,
          events: events.map((event) => event.type),
        }),
      );
    try {
      const result = await relay([outboxId]);
      for (const name of result.errors) {
        report(name);
      }
    } catch (error: unknown) {
      report(error instanceof Error ? error.name : "unknown");
    }
  };
}

async function startSender(): Promise<JobQueue> {
  const boss = new PgBoss({
    db: getQueueDatabase(),
    supervise: false,
    schedule: false,
  });
  await boss.start();
  return boss;
}

let sender: Promise<JobQueue> | undefined;

function sharedSender(): Promise<JobQueue> {
  sender ??= startSender();
  sender.catch(() => {
    sender = undefined;
  });
  return sender;
}

const sendPostEvents: PostEventsSender = createPostEventsSender(sharedSender);

// Course events have no consumer of their own; they feed the creators invite and feedback moments.
const checkCourseEvents: OutboxPublisher = async (row) => {
  courseEventsPayloadSchema.parse(row.payload);
};

export const publishOutboxRow: OutboxPublisher = withWebhookFanout(
  withWebhookFanout(
    withWebhookFanout(
      createOutboxDispatcher({
        [postEventsTopic]: createPostEventsOutboxPublisher(sendPostEvents),
        [membershipEventsTopic]: createMembershipEventsPublisher(sharedSender),
        [paidMembershipEventsTopic]: createPaidMembershipEventsPublisher(sharedSender),
        [domainEventsTopic]: createDomainEventsPublisher(sharedSender),
        [courseEventsTopic]: checkCourseEvents,
      }),
      createCreatorsInviteTrigger(
        sharedSender,
        () => getPlatformConfig().creatorsCommunity !== null,
      ),
    ),
    createWebhookFanoutPublisher(sharedSender),
  ),
  createFeedbackMomentsPublisher(sharedSender, () => parseEdition() === "cloud"),
);

export function relayPendingOutbox(options: RelayOptions = {}): Promise<RelayResult> {
  return relayOutbox(getDb(), publishOutboxRow, options);
}

export const publishPostEventsAfterCommit: PostEventsPublisher = relayAfterCommit((ids) =>
  relayPendingOutbox({ ids }),
);
