import { createHash } from "node:crypto";

import {
  getCommunityById,
  getDb,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Community,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { notifications, users } from "@cohory/db/schema";
import {
  communityEmailBrand,
  duplicateRefundedEmail,
  feeClearRequiredEmail,
  paidMembershipChangedEmail,
  paidMembershipNoticeText,
  paymentDisputedEmail,
  paymentDisputedNoticeText,
  sendEmail,
  type EmailMessage,
} from "@cohory/email";
import type { PaidMembershipEventsJobPayload } from "@cohory/events";
import { and, eq, isNull } from "drizzle-orm";

import { isMoneyEvent, moneyNotices } from "./money";
import type { Notice } from "./notice";

export type PaidMembershipEventInput = PaidMembershipEventsJobPayload["events"][number];

export interface PaidMembershipNoticeResult {
  readonly inserted: number;
  readonly emailed: number;
}

export type PaidMembershipNotifier = (
  events: readonly PaidMembershipEventInput[],
) => Promise<PaidMembershipNoticeResult>;

export interface PaidMembershipNotifierDeps {
  readonly db: Database;
  readonly appUrl: string;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly now?: () => Date;
}

const maxDetail = 300;
const stripeDashboardUrl = "https://dashboard.stripe.com/subscriptions";
const stripeDisputesUrl = "https://dashboard.stripe.com/disputes";

export function noticeNotificationId(noticeId: string, userId: string): string {
  const hex = createHash("sha256").update(`${noticeId}:${userId}`).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function clip(text: string): string {
  return text.length > maxDetail ? `${text.slice(0, maxDetail - 1)}…` : text;
}

interface Recipient {
  readonly email: string;
  readonly name: string;
}

async function loadRecipient(db: Database, userId: string): Promise<Recipient | null> {
  const [row] = await db
    .select({ email: users.email, name: users.name, erasedAt: users.erasedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row && row.erasedAt === null ? { email: row.email, name: row.name } : null;
}

export function createPaidMembershipNotifier(
  deps: PaidMembershipNotifierDeps,
): PaidMembershipNotifier {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  async function claimInApp(
    { tx, values }: ScopedQueries,
    community: Community,
    notice: Notice,
  ): Promise<boolean> {
    await setRlsValue(tx, "user_id", notice.userId);
    const id = noticeNotificationId(notice.noticeId, notice.userId);
    const [existing] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    if (existing) {
      return false;
    }
    const createdAt = now();
    await collapseEarlier(tx, community, notice, createdAt);
    await tx.insert(notifications).values(
      values({
        id,
        userId: notice.userId,
        actorId: notice.actorId,
        type: notice.type,
        subjectType: "community" as const,
        subjectId: community.id,
        postId: null,
        detail: clip(notice.detail),
        createdAt,
      }),
    );
    return true;
  }

  async function collapseEarlier(
    tx: ScopedQueries["tx"],
    community: Community,
    notice: Notice,
    readAt: Date,
  ): Promise<void> {
    await tx
      .update(notifications)
      .set({ readAt })
      .where(
        and(
          eq(notifications.userId, notice.userId),
          eq(notifications.type, notice.type),
          eq(notifications.subjectId, community.id),
          eq(notifications.actorId, notice.actorId),
          isNull(notifications.readAt),
        ),
      );
  }

  async function deliver(
    community: Community | null,
    notice: Notice,
  ): Promise<{ inserted: number; emailed: number }> {
    const recipient = await loadRecipient(deps.db, notice.userId);
    if (!recipient) {
      return { inserted: 0, emailed: 0 };
    }
    const message: EmailMessage | null = notice.content
      ? { to: recipient.email, ...notice.content }
      : null;
    if (!community || !notice.inApp) {
      if (!message) {
        return { inserted: 0, emailed: 0 };
      }
      await deps.send(message);
      return { inserted: 0, emailed: 1 };
    }
    return runInCommunity(withCommunity(deps.db, community.id), async (queries) => {
      if (!(await claimInApp(queries, community, notice))) {
        return { inserted: 0, emailed: 0 };
      }
      if (!message) {
        return { inserted: 1, emailed: 0 };
      }
      await deps.send(message);
      return { inserted: 1, emailed: 1 };
    });
  }

  function membershipUrl(community: Community | null): string | null {
    return community ? `${appUrl}/c/${encodeURIComponent(community.slug)}/membership` : null;
  }

  async function noticesOf(
    event: PaidMembershipEventInput,
    community: Community | null,
  ): Promise<Notice[]> {
    const communityBrand = communityEmailBrand(community?.appearance);
    if (isMoneyEvent(event)) {
      const memberName = (await loadRecipient(deps.db, event.payload.userId))?.name ?? "";
      return moneyNotices(event, {
        memberName,
        membershipUrl: membershipUrl(community),
        communityBrand,
      });
    }
    if (event.type === "payments.fee_clear_required") {
      return [
        {
          inApp: false,
          type: "paid_membership_changed",
          userId: event.payload.ownerId,
          actorId: event.payload.ownerId,
          noticeId: event.payload.noticeId,
          detail: "",
          content: feeClearRequiredEmail({
            communityName: event.payload.communityName,
            dashboardUrl: stripeDashboardUrl,
            communityBrand,
          }),
        },
      ];
    }
    if (event.type === "payments.duplicate_refunded") {
      return [
        {
          inApp: false,
          type: "paid_membership_changed",
          userId: event.payload.userId,
          actorId: event.payload.userId,
          noticeId: event.payload.noticeId,
          detail: "",
          content: duplicateRefundedEmail({
            communityName: event.payload.communityName,
            amountMinor: event.payload.amountMinor,
            currency: event.payload.currency,
            membershipUrl: membershipUrl(community),
            communityBrand,
          }),
        },
      ];
    }
    if (event.type === "payments.payment_disputed") {
      const copy = {
        communityName: event.payload.communityName,
        amountMinor: event.payload.amountMinor,
        currency: event.payload.currency,
      };
      return [
        {
          inApp: true,
          type: "payment_disputed",
          userId: event.payload.ownerId,
          actorId: event.payload.ownerId,
          noticeId: event.payload.noticeId,
          detail: paymentDisputedNoticeText(copy),
          content: paymentDisputedEmail({
            ...copy,
            dashboardUrl: stripeDisputesUrl,
            communityBrand,
          }),
        },
      ];
    }
    const { payload } = event;
    return payload.recipients.map((recipient) => {
      const copy = {
        communityName: payload.communityName,
        change: payload.change,
        endsAt: recipient.endsAt ? new Date(recipient.endsAt) : null,
        supportContact: payload.supportContact,
        portalLoginUrl: payload.portalLoginUrl,
      };
      return {
        inApp: true,
        type: "paid_membership_changed",
        userId: recipient.userId,
        actorId: payload.actorId,
        noticeId: payload.noticeId,
        detail: paidMembershipNoticeText(copy),
        content: paidMembershipChangedEmail({
          ...copy,
          membershipUrl: membershipUrl(community),
          communityBrand,
        }),
      };
    });
  }

  return async (events) => {
    let inserted = 0;
    let emailed = 0;
    for (const event of events) {
      const community = await getCommunityById(
        deps.db,
        parseCommunityId(event.payload.communityId),
      );
      for (const notice of await noticesOf(event, community)) {
        const result = await deliver(community, notice);
        inserted += result.inserted;
        emailed += result.emailed;
      }
    }
    return { inserted, emailed };
  };
}

let defaultNotifier: PaidMembershipNotifier | undefined;

export function getPaidMembershipNotifier(appUrl: string): PaidMembershipNotifier {
  defaultNotifier ??= createPaidMembershipNotifier({ db: getDb(), appUrl, send: sendEmail });
  return defaultNotifier;
}
