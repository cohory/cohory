import { createHash } from "node:crypto";
import { setRlsFlag } from "@cohory/db";
import { logger } from "@cohory/infra/logger";

import type { Database } from "@cohory/db";
import { emailLog, type EmailLogStatus } from "@cohory/db/schema";

import type { Mailer } from "./message";

export interface EmailLogEntry {
  readonly template: string;
  readonly recipientHash: string;
  readonly status: EmailLogStatus;
  readonly errorCode: string | null;
}

export interface EmailLog {
  record(entry: EmailLogEntry): Promise<void>;
}

export function hashEmailAddress(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

const errorCodeFormat = /^[A-Za-z0-9_.-]{1,64}$/;

export function emailErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "unknown";
  }
  if ("responseCode" in error && typeof error.responseCode === "number") {
    return `smtp_${error.responseCode}`;
  }
  if ("code" in error && typeof error.code === "string" && errorCodeFormat.test(error.code)) {
    return error.code;
  }
  return "unknown";
}

type ReportLogError = (error: unknown) => void;

const reportToConsole: ReportLogError = (error) => {
  logger.error(
    {
      reason: error instanceof Error ? error.message : String(error),
    },
    "Could not write the email log",
  );
};

export function withEmailLog(
  mailer: Mailer,
  log: EmailLog,
  reportLogError: ReportLogError = reportToConsole,
): Mailer {
  const record = async (entry: EmailLogEntry) => {
    try {
      await log.record(entry);
    } catch (error) {
      reportLogError(error);
    }
  };
  return {
    async send(message) {
      const base = {
        template: message.template ?? "other",
        recipientHash: hashEmailAddress(message.to),
      };
      try {
        await mailer.send(message);
      } catch (error) {
        await record({ ...base, status: "failed", errorCode: emailErrorCode(error) });
        throw error;
      }
      await record({ ...base, status: "sent", errorCode: null });
    },
  };
}

export function createDbEmailLog(db: () => Database): EmailLog {
  return {
    async record(entry) {
      await db().transaction(async (tx) => {
        await setRlsFlag(tx, "email_delivery");
        await tx.insert(emailLog).values(entry);
      });
    },
  };
}
