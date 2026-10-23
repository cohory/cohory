import { getQueueDatabase } from "@cohory/db";
import { PgBoss } from "pg-boss";

import { migrationJobNames, migrationQueueOptions, type MigrationQueue } from "./jobs";

export function createPgBossMigrationQueue(): MigrationQueue {
  let ready: Promise<PgBoss> | undefined;

  function queue(): Promise<PgBoss> {
    ready ??= (async () => {
      const boss = new PgBoss({
        db: getQueueDatabase(),
        supervise: false,
        schedule: false,
      });
      await boss.start();
      for (const name of migrationJobNames) {
        await boss.createQueue(name, migrationQueueOptions);
      }
      return boss;
    })();
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }

  return {
    async enqueue(name, payload, options = {}) {
      const boss = await queue();
      await boss.send(name, payload, options.startAfter ? { startAfter: options.startAfter } : {});
    },
  };
}
