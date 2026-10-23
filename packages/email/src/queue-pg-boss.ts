import { getQueueDatabase } from "@cohory/db";
import { PgBoss } from "pg-boss";

import { createEmailOutbox, type EmailOutbox } from "./queue";

let defaultOutbox: EmailOutbox | undefined;

export function getEmailOutbox(): EmailOutbox {
  defaultOutbox ??= createEmailOutbox(async () => {
    const boss = new PgBoss({ db: getQueueDatabase(), supervise: false, schedule: false });
    await boss.start();
    return boss;
  });
  return defaultOutbox;
}
