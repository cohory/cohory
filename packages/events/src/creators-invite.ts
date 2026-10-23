import {
  creatorsInviteDelayDays,
  creatorsInviteInputSchema,
  type CreatorsInviteInput,
} from "@cohory/communities/creators-invite";
import { postEventsTopic } from "@cohory/posts";
import type { SendOptions } from "pg-boss";

import { courseEventsPayloadSchema, courseEventsTopic } from "./course-events";
import type { JobQueue } from "./dispatch";
import { domainEventsPayloadSchema, domainEventsTopic } from "./domain";
import type { OutboxPublisher, PendingOutboxRow } from "./outbox";
import { postEventsJobPayloadSchema } from "./schema";

export const creatorsInviteJob = "communities.creators-invite";
export const creatorsInviteDelaySeconds = creatorsInviteDelayDays * 24 * 60 * 60;
export const creatorsInviteJobPayloadSchema = creatorsInviteInputSchema;

const contentThrottleSeconds = 60 * 60;

interface CreatorsInviteSend {
  readonly payload: CreatorsInviteInput;
  readonly options: SendOptions;
}

const retry = { retryLimit: 5, retryBackoff: true } as const;

function created(communityId: string): CreatorsInviteSend {
  return {
    payload: { communityId, trigger: "created" },
    options: {
      ...retry,
      singletonKey: `creators-invite:created:${communityId}`,
      startAfter: creatorsInviteDelaySeconds,
    },
  };
}

// Every published post or course asks, so a busy community could queue many jobs; the hourly
// throttle keeps that to one per community, and the service drops all but the first anyway.
function published(communityId: string, trigger: "post" | "course"): CreatorsInviteSend {
  return {
    payload: { communityId, trigger },
    options: {
      ...retry,
      singletonKey: `creators-invite:content:${communityId}`,
      singletonSeconds: contentThrottleSeconds,
    },
  };
}

function unique(communityIds: readonly string[]): string[] {
  return [...new Set(communityIds)];
}

export function creatorsInviteSends(row: PendingOutboxRow): CreatorsInviteSend[] {
  switch (row.topic) {
    case domainEventsTopic:
      return unique(
        domainEventsPayloadSchema
          .parse(row.payload)
          .events.flatMap((event) =>
            event.type === "member.joined" && event.payload.role === "owner"
              ? [event.payload.communityId]
              : [],
          ),
      ).map(created);
    case postEventsTopic:
      return unique(
        postEventsJobPayloadSchema
          .parse(row.payload)
          .events.flatMap((event) =>
            event.type === "post.created" ? [event.payload.communityId] : [],
          ),
      ).map((communityId) => published(communityId, "post"));
    case courseEventsTopic:
      return unique(
        courseEventsPayloadSchema
          .parse(row.payload)
          .events.map((event) => event.payload.communityId),
      ).map((communityId) => published(communityId, "course"));
    default:
      return [];
  }
}

export function createCreatorsInviteTrigger(
  getQueue: () => Promise<JobQueue>,
  enabled: () => boolean,
): OutboxPublisher {
  let ready: Promise<JobQueue> | undefined;
  function queue(): Promise<JobQueue> {
    ready ??= getQueue().then(async (q) => {
      await q.createQueue(creatorsInviteJob);
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
    const sends = creatorsInviteSends(row);
    if (sends.length === 0) {
      return;
    }
    const jobs = await queue();
    for (const send of sends) {
      await jobs.send(creatorsInviteJob, send.payload, send.options);
    }
  };
}
