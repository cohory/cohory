import {
  getCommunityById,
  getDb,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
} from "@cohory/db";
import { notifications, users } from "@cohory/db/schema";
import {
  communityEmailBrand,
  sendEmail,
  tokenExpiringEmail,
  type EmailMessage,
} from "@cohory/email";
import { eq } from "drizzle-orm";

import { noticeNotificationId } from "./paid-membership";

export interface TokenExpiryNotice {
  readonly communityId: string;
  readonly communitySlug: string;
  readonly communityName: string;
  readonly tokenId: string;
  readonly userId: string;
  readonly tokenName: string;
  readonly agentName: string | null;
  readonly expiresAt: Date;
}

export interface TokenExpiryNoticeResult {
  readonly inserted: boolean;
  readonly emailed: boolean;
}

export type TokenExpiryNotifier = (notice: TokenExpiryNotice) => Promise<TokenExpiryNoticeResult>;

export interface TokenExpiryNotifierDeps {
  readonly db: Database;
  readonly appUrl: string;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly now?: () => Date;
}

const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export function tokenExpiryNotificationId(tokenId: string, userId: string): string {
  return noticeNotificationId(`token_expiring:${tokenId}`, userId);
}

export function tokenExpiryPath(notice: Pick<TokenExpiryNotice, "agentName" | "communitySlug">) {
  return notice.agentName === null
    ? "/account/api-tokens"
    : `/account/agents?community=${encodeURIComponent(notice.communitySlug)}`;
}

export function tokenExpiryDetail(notice: TokenExpiryNotice): string {
  const where = notice.agentName === null ? "Account, API tokens" : "Account, Agents";
  const subject =
    notice.agentName === null
      ? `Your token ${notice.tokenName}`
      : `${notice.agentName}'s token ${notice.tokenName}`;
  return `${subject} expires on ${day.format(notice.expiresAt)}. Regenerate it in ${where}.`;
}

export function createTokenExpiryNotifier(deps: TokenExpiryNotifierDeps): TokenExpiryNotifier {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  return async (notice) => {
    const communityId = parseCommunityId(notice.communityId);
    const [recipient] = await deps.db
      .select({ email: users.email, erasedAt: users.erasedAt })
      .from(users)
      .where(eq(users.id, notice.userId))
      .limit(1);
    const community = await getCommunityById(deps.db, communityId);
    return runInCommunity(withCommunity(deps.db, communityId), async (q) => {
      await setRlsValue(q.tx, "user_id", notice.userId);
      const at = now();
      const result = await q.tx
        .insert(notifications)
        .values(
          q.values({
            id: tokenExpiryNotificationId(notice.tokenId, notice.userId),
            userId: notice.userId,
            actorId: notice.userId,
            type: "token_expiring" as const,
            subjectType:
              notice.agentName === null ? ("api_token" as const) : ("agent_token" as const),
            subjectId: notice.tokenId,
            postId: null,
            detail: tokenExpiryDetail(notice),
            createdAt: at,
          }),
        )
        .onConflictDoNothing();
      if ((result.rowCount ?? 0) === 0) {
        return { inserted: false, emailed: false };
      }
      if (!recipient || recipient.erasedAt !== null) {
        return { inserted: true, emailed: false };
      }
      await deps.send({
        to: recipient.email,
        ...tokenExpiringEmail({
          communityName: notice.communityName,
          communityBrand: communityEmailBrand(community?.appearance),
          tokenName: notice.tokenName,
          agentName: notice.agentName,
          expiresAt: notice.expiresAt,
          now: at,
          url: `${appUrl}${tokenExpiryPath(notice)}`,
        }),
      });
      return { inserted: true, emailed: true };
    });
  };
}

let defaultNotifier: TokenExpiryNotifier | undefined;

export function getTokenExpiryNotifier(appUrl: string): TokenExpiryNotifier {
  defaultNotifier ??= createTokenExpiryNotifier({ db: getDb(), appUrl, send: sendEmail });
  return defaultNotifier;
}
