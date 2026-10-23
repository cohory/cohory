import { getDb } from "@cohory/db";

import { createLogMailer } from "./drivers/log";
import { createSmtpMailer } from "./drivers/smtp";
import { parseEmailEnv, type EmailEnv } from "./env";
import { createDbEmailLog, withEmailLog, type EmailLog } from "./log";
import type { EmailMessage, Mailer } from "./message";
import { createDbSuppressionList, withSuppression, type SuppressionList } from "./suppression";

export function createMailer(env: EmailEnv): Mailer {
  switch (env.driver) {
    case "log":
      return createLogMailer();
    case "smtp":
      return createSmtpMailer(env);
  }
}

let defaultMailer: Mailer | undefined;
let defaultSuppressionList: SuppressionList | undefined;
let defaultEmailLog: EmailLog | undefined;

export function getEmailLog(): EmailLog {
  defaultEmailLog ??= createDbEmailLog(getDb);
  return defaultEmailLog;
}

export function getSuppressionList(): SuppressionList {
  defaultSuppressionList ??= createDbSuppressionList(getDb);
  return defaultSuppressionList;
}

export function getMailer(): Mailer {
  if (!defaultMailer) {
    const log = getEmailLog();
    defaultMailer = withSuppression(withEmailLog(createMailer(parseEmailEnv()), log), {
      list: getSuppressionList(),
      log,
    });
  }
  return defaultMailer;
}

export function sendEmail(message: EmailMessage): Promise<void> {
  return getMailer().send(message);
}
