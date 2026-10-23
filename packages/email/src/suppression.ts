import type { Database, Transaction } from "@cohory/db";
import {
  emailSuppressions,
  type EmailSuppressionReason,
  type EmailSuppressionSource,
} from "@cohory/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { setRlsFlag } from "@cohory/db";
import { logger } from "@cohory/infra/logger";

import { hashEmailAddress, type EmailLog } from "./log";
import type { EmailMessage, Mailer } from "./message";
import type { EmailTemplateId } from "./templates/ids";

// Emails a person triggers for their own account, and the notices that warn them about changes
// to it. A bounce or complaint must never lock someone out or hide a takeover.
const securityTemplateIds = [
  "email-verification",
  "password-reset",
  "magic-link",
  "change-email-verification",
  "change-email-confirmation",
  "existing-account-sign-up",
  "password-changed",
  "password-removed",
] as const satisfies readonly EmailTemplateId[];

export const securityEmailTemplates: ReadonlySet<EmailTemplateId> = new Set(securityTemplateIds);

export function isSecurityEmail(message: Pick<EmailMessage, "template">): boolean {
  return message.template !== undefined && securityEmailTemplates.has(message.template);
}

export interface SuppressionLookup {
  readonly addressHash: string;
  readonly communityId?: string | undefined;
}

export interface SuppressionEntry {
  readonly addressHash: string;
  readonly communityId: string | null;
  readonly reason: EmailSuppressionReason;
  readonly source: EmailSuppressionSource;
}

export interface SuppressionList {
  suppressionReason(lookup: SuppressionLookup): Promise<EmailSuppressionReason | null>;
  isSuppressed(lookup: SuppressionLookup): Promise<boolean>;
  suppress(entry: SuppressionEntry): Promise<void>;
  lift(target: { addressHash: string; communityId: string | null }): Promise<number>;
}

function hasRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null;
}

const enhancedStatus = /\b5\.(\d{1,3})\.(\d{1,3})\b/;
const bareRecipientCodes: ReadonlySet<number> = new Set([550, 551, 553]);

// Only a bad mailbox (5.1.x) or a disabled mailbox (5.2.1) says the address is dead. Relay,
// blocklist, and policy replies (5.7.x, 5.4.x) are about us, and suppressing on them would drop
// healthy addresses.
export function isPermanentRecipientFailure(error: unknown): boolean {
  if (!hasRecord(error) || typeof error["responseCode"] !== "number") {
    return false;
  }
  const code = error["responseCode"];
  if (code < 500 || code > 599) {
    return false;
  }
  const response = error["response"];
  const enhanced = typeof response === "string" ? enhancedStatus.exec(response) : null;
  if (enhanced) {
    const [, subject, detail] = enhanced;
    return subject === "1" || (subject === "2" && detail === "1");
  }
  return error["command"] === "RCPT TO" && bareRecipientCodes.has(code);
}

type ReportError = (error: unknown) => void;

const reportToConsole: ReportError = (error) => {
  logger.error(
    {
      reason: error instanceof Error ? error.message : String(error),
    },
    "Could not update the email suppression list",
  );
};

export interface SuppressionOptions {
  readonly list: SuppressionList;
  readonly log: EmailLog;
  readonly reportError?: ReportError;
}

export function withSuppression(mailer: Mailer, options: SuppressionOptions): Mailer {
  const { list, log, reportError = reportToConsole } = options;
  return {
    async send(message) {
      const addressHash = hashEmailAddress(message.to);
      if (!isSecurityEmail(message)) {
        const reason = await list.suppressionReason({
          addressHash,
          communityId: message.communityId,
        });
        if (reason !== null) {
          try {
            await log.record({
              template: message.template ?? "other",
              recipientHash: addressHash,
              status: "suppressed",
              errorCode: reason,
            });
          } catch (error) {
            reportError(error);
          }
          return;
        }
      }
      try {
        await mailer.send(message);
      } catch (error) {
        if (!isPermanentRecipientFailure(error)) {
          throw error;
        }
        try {
          await list.suppress({
            addressHash,
            communityId: null,
            reason: "hard_bounce",
            source: "smtp",
          });
        } catch (suppressError) {
          reportError(suppressError);
        }
      }
    },
  };
}

export function createMemorySuppressionList(): SuppressionList {
  const entries: SuppressionEntry[] = [];
  const matches = (entry: SuppressionEntry, lookup: SuppressionLookup) =>
    entry.addressHash === lookup.addressHash &&
    (entry.communityId === null || entry.communityId === lookup.communityId);
  const list: SuppressionList = {
    async suppressionReason(lookup) {
      return entries.find((entry) => matches(entry, lookup))?.reason ?? null;
    },
    async isSuppressed(lookup) {
      return (await list.suppressionReason(lookup)) !== null;
    },
    async suppress(entry) {
      if (
        !entries.some(
          (existing) =>
            existing.addressHash === entry.addressHash &&
            existing.communityId === entry.communityId,
        )
      ) {
        entries.push(entry);
      }
    },
    async lift(target) {
      const before = entries.length;
      const kept = entries.filter(
        (entry) =>
          entry.addressHash !== target.addressHash || entry.communityId !== target.communityId,
      );
      entries.splice(0, entries.length, ...kept);
      return before - kept.length;
    },
  };
  return list;
}

export function createDbSuppressionList(db: () => Database): SuppressionList {
  async function asDelivery<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db().transaction(async (tx) => {
      await setRlsFlag(tx, "email_delivery");
      return fn(tx);
    });
  }

  const list: SuppressionList = {
    async suppressionReason({ addressHash, communityId }) {
      const scope =
        communityId === undefined
          ? isNull(emailSuppressions.communityId)
          : or(
              isNull(emailSuppressions.communityId),
              eq(emailSuppressions.communityId, communityId),
            );
      const [row] = await asDelivery((tx) =>
        tx
          .select({ reason: emailSuppressions.reason })
          .from(emailSuppressions)
          .where(and(eq(emailSuppressions.addressHash, addressHash), scope))
          .orderBy(sql`${emailSuppressions.communityId} is not null`)
          .limit(1),
      );
      return row?.reason ?? null;
    },
    async isSuppressed(lookup) {
      return (await list.suppressionReason(lookup)) !== null;
    },
    async suppress(entry) {
      await asDelivery((tx) => tx.insert(emailSuppressions).values(entry).onConflictDoNothing());
    },
    async lift({ addressHash, communityId }) {
      const removed = await asDelivery((tx) =>
        tx
          .delete(emailSuppressions)
          .where(
            and(
              eq(emailSuppressions.addressHash, addressHash),
              communityId === null
                ? isNull(emailSuppressions.communityId)
                : eq(emailSuppressions.communityId, communityId),
            ),
          )
          .returning({ id: emailSuppressions.id }),
      );
      return removed.length;
    },
  };
  return list;
}
