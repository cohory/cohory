import {
  getCommunityById,
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
} from "@cohory/db";
import { memberships, notifications, users } from "@cohory/db/schema";
import {
  communityEmailBrand,
  ownershipTransferredEmail,
  sendEmail,
  type EmailMessage,
} from "@cohory/email";
import type { MembershipEventsJobPayload } from "@cohory/events";
import { and, eq, inArray, ne } from "drizzle-orm";

import type { FanoutResult } from "./fanout";
import { noticeNotificationId } from "./paid-membership";

export type MembershipEventInput = MembershipEventsJobPayload["events"][number];

type OwnershipTransferredPayload = Extract<
  MembershipEventInput,
  { type: "ownership.transferred" }
>["payload"];

export function transferNoticeText(communityName: string): string {
  return `${communityName} has a new owner. If it sells memberships, new checkouts pause until the new owner chooses a Stripe account in Manage, Payments.`;
}

export type MembershipNotifier = (events: readonly MembershipEventInput[]) => Promise<FanoutResult>;

export interface MembershipNotifierDeps {
  readonly db: Database;
  readonly appUrl: string;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const staffRoles = ["owner", "admin", "moderator"] as const;

export function createMembershipNotifier(deps: MembershipNotifierDeps): MembershipNotifier {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  async function notifyTransfer(payload: OwnershipTransferredPayload): Promise<number> {
    const communityId = parseCommunityId(payload.communityId);
    const community = await getCommunityById(deps.db, communityId);
    if (!community) {
      return 0;
    }
    const detail = transferNoticeText(community.name);
    return runInCommunity(withCommunity(deps.db, communityId), async ({ tx, values }) => {
      const createdAt = now();
      const insertNotice = async (userId: string) => {
        const result = await tx
          .insert(notifications)
          .values(
            values({
              id: noticeNotificationId(payload.noticeId, userId),
              userId,
              actorId: payload.previousOwnerId,
              type: "ownership_transferred" as const,
              subjectType: "community" as const,
              subjectId: communityId,
              postId: null,
              detail,
              createdAt,
            }),
          )
          .onConflictDoNothing();
        return (result.rowCount ?? 0) > 0;
      };
      const previousNotified = await insertNotice(payload.previousOwnerId);
      const ownerNotified = await insertNotice(payload.newOwnerId);
      if (ownerNotified) {
        const people = await tx
          .select({ id: users.id, name: users.name, email: users.email, erasedAt: users.erasedAt })
          .from(users)
          .where(inArray(users.id, [payload.previousOwnerId, payload.newOwnerId]));
        const owner = people.find((person) => person.id === payload.newOwnerId);
        const previous = people.find((person) => person.id === payload.previousOwnerId);
        if (owner && owner.erasedAt === null) {
          await deps.send({
            to: owner.email,
            ...ownershipTransferredEmail({
              communityName: community.name,
              previousOwnerName: previous?.name ?? "",
              paymentsUrl: `${appUrl}/c/${encodeURIComponent(community.slug)}/manage/payments`,
              communityBrand: communityEmailBrand(community.appearance),
            }),
          });
        }
      }
      return Number(previousNotified) + Number(ownerNotified);
    });
  }

  return async (events) => {
    let inserted = 0;
    for (const event of events) {
      if (event.type === "ownership.transferred") {
        inserted += await notifyTransfer(event.payload);
        continue;
      }
      const scope = withCommunity(deps.db, parseCommunityId(event.payload.communityId));
      inserted += await runInCommunity(scope, async ({ tx, where, values }) => {
        const createdAt = now();
        const subject = {
          subjectType: "membership_request" as const,
          subjectId: event.payload.requestId,
          postId: null,
          createdAt,
        };
        if (event.type === "join_request.created") {
          const staff = await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              where(
                memberships,
                eq(memberships.status, "active"),
                inArray(memberships.role, [...staffRoles]),
                ne(memberships.userId, event.payload.userId),
              ),
            );
          if (staff.length === 0) {
            return 0;
          }
          const result = await tx
            .insert(notifications)
            .values(
              staff.map((member) =>
                values({
                  id: makeId(),
                  userId: member.userId,
                  actorId: event.payload.userId,
                  type: "join_request" as const,
                  ...subject,
                }),
              ),
            )
            .onConflictDoNothing();
          return result.rowCount ?? 0;
        }
        const [banned] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            where(
              memberships,
              and(eq(memberships.userId, event.payload.userId), eq(memberships.status, "banned")),
            ),
          );
        if (banned) {
          return 0;
        }
        const result = await tx
          .insert(notifications)
          .values(
            values({
              id: makeId(),
              userId: event.payload.userId,
              actorId: event.payload.decidedBy,
              type:
                event.payload.status === "approved"
                  ? ("join_request_approved" as const)
                  : ("join_request_declined" as const),
              ...subject,
            }),
          )
          .onConflictDoNothing();
        return result.rowCount ?? 0;
      });
    }
    return { inserted };
  };
}

let defaultNotifier: MembershipNotifier | undefined;

export function getMembershipNotifier(appUrl: string): MembershipNotifier {
  defaultNotifier ??= createMembershipNotifier({ db: getDb(), appUrl, send: sendEmail });
  return defaultNotifier;
}
