import { getDb, type Database } from "@cohory/db";
import {
  communityEmailBrand,
  notificationDigestEmail,
  notificationEmail,
  sendEmail,
  type EmailMessage,
} from "@cohory/email";

import { notificationPath } from "../links";
import {
  createUnsubscribeToken,
  unsubscribeSecretFromEnv,
  type UnsubscribeScope,
} from "../unsubscribe";
import { createEmailClaims, type Candidate, type Group, type Recipient } from "./claims";
import { composeNotificationEmail, digestSubject, emailLine, type EmailNotice } from "./content";
import { loadEmailContent } from "./gated-content";
import type { EmailPass } from "./plan";

export const notificationsEmailJob = "notifications.email";
export const notificationsDigestJob = "notifications.digest";
export const notificationsEmailCron = "* * * * *";
export const notificationsDigestCron = "*/15 * * * *";

export interface NotificationEmailJobsDeps {
  readonly db: Database;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly appUrl: string;
  readonly secret: string;
  readonly now?: () => Date;
  readonly onSendError?: (error: unknown, userId: string) => void;
}

export interface EmailRunResult {
  readonly users: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

export function createNotificationEmailJobs(deps: NotificationEmailJobsDeps) {
  const { scan, claim, release } = createEmailClaims(deps.db);
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");
  const preferencesUrl = `${appUrl}/account/notifications`;
  const mailHost = new URL(appUrl).hostname;

  function communityHeaders(n: Candidate): Record<string, string> {
    const headers: Record<string, string> = {};
    if (n.communitySlug) {
      const name = (n.communityName ?? n.communitySlug).replace(/["\\\r\n]/g, "");
      headers["List-Id"] = `"${name}" <${n.communitySlug}.${mailHost}>`;
    }
    if (n.postId) {
      const thread = `<post-${n.postId}@${mailHost}>`;
      headers["References"] = thread;
      headers["In-Reply-To"] = thread;
    }
    return headers;
  }

  function unsubscribeLinks(userId: string, scope: UnsubscribeScope) {
    const token = createUnsubscribeToken(deps.secret, { userId, scope });
    return {
      unsubscribeUrl: `${appUrl}/unsubscribe?token=${token}`,
      headers: {
        "List-Unsubscribe": `<${appUrl}/api/v1/notification-preferences/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }

  function postUrl(n: Candidate): string {
    return `${appUrl}${notificationPath({
      type: n.type,
      subjectType: n.subjectType,
      communitySlug: n.communitySlug ?? "",
      postId: n.postId,
    })}`;
  }

  function notice(n: Candidate, excerpt: string | null = null): EmailNotice {
    return {
      type: n.type,
      subjectType: n.subjectType,
      actorName: n.actorName,
      detail: n.detail,
      excerpt,
    };
  }

  async function sendGroup(userId: string, recipient: Recipient, group: Group, at: Date) {
    const [first, ...rest] = group;
    const content = await loadEmailContent(deps.db, userId, group, at);
    const withExcerpt = (n: Candidate) => notice(n, content.excerpts.get(n.id) ?? null);
    const communityName = first.communityName ?? "";
    const email = composeNotificationEmail({
      notices: [withExcerpt(first), ...rest.map(withExcerpt)],
      communityName,
      postTitle: content.postTitle,
      postId: first.postId,
    });
    const links = unsubscribeLinks(userId, email.scope);
    await deps.send({
      to: recipient.email,
      ...(first.communityId ? { communityId: first.communityId } : {}),
      headers: { ...links.headers, ...communityHeaders(first) },
      ...notificationEmail({
        name: recipient.name,
        subject: email.subject,
        ...(email.heading ? { heading: email.heading } : {}),
        items: email.items,
        cta: { label: email.ctaLabel, url: postUrl(first) },
        communityName,
        communityBrand: communityEmailBrand(first.communityAppearance),
        reason: email.reason,
        ...(email.stopLabel ? { stopLabel: email.stopLabel } : {}),
        unsubscribeUrl: links.unsubscribeUrl,
        preferencesUrl,
      }),
    });
  }

  async function deliver(pass: EmailPass, userId: string, at: Date) {
    const claimed = await claim(pass, userId, at);
    let sent = 0;
    let failed = 0;
    const recipient = claimed.recipient;
    if (!recipient) {
      return { sent, failed, skipped: claimed.skipped };
    }
    for (const group of claimed.immediate) {
      try {
        await sendGroup(userId, recipient, group, at);
        sent += 1;
      } catch (error: unknown) {
        failed += 1;
        deps.onSendError?.(error, userId);
        await release(
          userId,
          group.map((n) => n.id),
        );
      }
    }
    if (claimed.digest.length > 0) {
      const links = unsubscribeLinks(userId, "daily");
      try {
        await deps.send({
          to: recipient.email,
          headers: links.headers,
          ...notificationDigestEmail({
            name: recipient.name,
            subject: digestSubject(claimed.digest.map((n) => notice(n))),
            items: claimed.digest.map((n) => ({
              text: emailLine(notice(n)),
              communityName: n.communityName ?? "",
              url: postUrl(n),
            })),
            unsubscribeUrl: links.unsubscribeUrl,
            preferencesUrl,
          }),
        });
        sent += 1;
      } catch (error: unknown) {
        failed += 1;
        deps.onSendError?.(error, userId);
        await release(
          userId,
          claimed.digest.map((n) => n.id),
          claimed.previousDigestAt,
        );
      }
    }
    return { sent, failed, skipped: claimed.skipped };
  }

  async function run(pass: EmailPass): Promise<EmailRunResult> {
    const at = now();
    const userIds = await scan(pass, at);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const userId of userIds) {
      const result = await deliver(pass, userId, at);
      sent += result.sent;
      skipped += result.skipped;
      failed += result.failed;
    }
    return { users: userIds.length, sent, skipped, failed };
  }

  return {
    sendImmediate: () => run("immediate"),
    sendDigests: () => run("digest"),
  };
}

export type NotificationEmailJobs = ReturnType<typeof createNotificationEmailJobs>;

let defaultJobs: NotificationEmailJobs | undefined;

export function getNotificationEmailJobs(
  appUrl: string,
  onSendError?: NotificationEmailJobsDeps["onSendError"],
): NotificationEmailJobs {
  defaultJobs ??= createNotificationEmailJobs({
    db: getDb(),
    send: sendEmail,
    appUrl,
    secret: unsubscribeSecretFromEnv(),
    onSendError,
  });
  return defaultJobs;
}
