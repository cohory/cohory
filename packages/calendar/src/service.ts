import { parseAppUrl } from "@cohory/config/platform";
import { getDb } from "@cohory/db";
import { getRateLimiter } from "@cohory/rate-limit";
import { logger } from "@cohory/infra/logger";

import { createPostgresCalendarRepository } from "./postgres-repository";
import { createRuntime, type CalendarServiceDeps } from "./service/context";
import { createEventOperations, type EventOperations } from "./service/events";
import { createOccurrenceOperations, type OccurrenceOperations } from "./service/occurrences";
import { createTeaserOperations, type TeaserOperations } from "./service/teaser";
import { createPgBossCalendarQueue } from "./time-change-pg-boss";

export type CalendarService = EventOperations & OccurrenceOperations & TeaserOperations;

export function createCalendarService(deps: CalendarServiceDeps): CalendarService {
  const runtime = createRuntime(deps);
  return {
    ...createEventOperations(runtime),
    ...createOccurrenceOperations(runtime),
    ...createTeaserOperations(runtime),
  };
}

let defaultService: CalendarService | undefined;

export function getCalendarService(): CalendarService {
  defaultService ??= createCalendarService({
    repo: createPostgresCalendarRepository(getDb()),
    appUrl: parseAppUrl(),
    rateLimit: (rule, userId) => getRateLimiter().consume(rule, userId),
    queue: createPgBossCalendarQueue(),
    onQueueError: (error, payload) => {
      logger.warn(
        {
          error: error instanceof Error ? error.name : "unknown",
          communityId: payload.communityId,
          job: "kind" in payload ? payload.kind : "time_change",
        },
        "calendar job not queued",
      );
    },
  });
  return defaultService;
}
