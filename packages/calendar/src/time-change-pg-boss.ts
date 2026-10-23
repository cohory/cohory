import { randomUUID } from "node:crypto";

import { getQueueDatabase } from "@cohory/db";
import { PgBoss } from "pg-boss";

import { noticeJob, noticeKey, noticeQueueOptions } from "./notices";
import {
  timeChangeDelaySeconds,
  timeChangeJob,
  timeChangeQueueOptions,
  type CalendarQueue,
} from "./time-change";

export function createPgBossCalendarQueue(): CalendarQueue {
  let ready: Promise<PgBoss> | undefined;

  function queue(): Promise<PgBoss> {
    ready ??= (async () => {
      const boss = new PgBoss({
        db: getQueueDatabase(),
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(timeChangeJob, timeChangeQueueOptions);
      await boss.createQueue(noticeJob, noticeQueueOptions);
      return boss;
    })();
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }

  return {
    async scheduleNotice(payload) {
      const boss = await queue();
      await boss.send(noticeJob, payload, {
        retryLimit: noticeQueueOptions.retryLimit,
        retryBackoff: noticeQueueOptions.retryBackoff,
        singletonKey: noticeKey(payload),
      });
    },

    async scheduleTimeChange(payload) {
      const boss = await queue();
      const options = {
        retryLimit: timeChangeQueueOptions.retryLimit,
        retryBackoff: timeChangeQueueOptions.retryBackoff,
        startAfter: timeChangeDelaySeconds,
      };
      if (payload.baseline.length > 0) {
        await boss.send(
          timeChangeJob,
          { ...payload, removals: [] },
          { ...options, singletonKey: `${payload.eventId}:moves` },
        );
      }
      if (payload.removals.length > 0) {
        await boss.send(
          timeChangeJob,
          { ...payload, baseline: [] },
          { ...options, singletonKey: `${payload.eventId}:removals:${randomUUID()}` },
        );
      }
    },
  };
}
