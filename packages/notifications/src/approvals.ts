import {
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
} from "@cohory/db";
import { memberships, notifications } from "@cohory/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

export interface ApprovalNotice {
  readonly communityId: string;
  readonly approvalId: string;
  readonly ownerUserId: string;
  readonly detail: string;
}

export type ApprovalNotifier = (notice: ApprovalNotice) => Promise<number>;

export interface ApprovalNotifierDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const deciders = ["owner", "admin"] as const;
const maxDetail = 300;

export function createApprovalNotifier(deps: ApprovalNotifierDeps): ApprovalNotifier {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;

  return (notice) =>
    runInCommunity(
      withCommunity(deps.db, parseCommunityId(notice.communityId)),
      async ({ tx, where, values }) => {
        const staff = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            where(
              memberships,
              and(eq(memberships.status, "active"), inArray(memberships.role, [...deciders])),
            ),
          );
        const recipients = new Set([notice.ownerUserId, ...staff.map((row) => row.userId)]);
        const createdAt = now();
        const detail =
          notice.detail.length > maxDetail
            ? `${notice.detail.slice(0, maxDetail - 1)}…`
            : notice.detail;
        const result = await tx
          .insert(notifications)
          .values(
            [...recipients].map((userId) =>
              values({
                id: makeId(),
                userId,
                actorId: notice.ownerUserId,
                type: "approval_request" as const,
                subjectType: "approval_request" as const,
                subjectId: notice.approvalId,
                postId: null,
                detail,
                createdAt,
              }),
            ),
          )
          .onConflictDoNothing();
        return result.rowCount ?? 0;
      },
    );
}

export interface ApprovalNoticeRead {
  readonly communityId: string;
  readonly approvalId: string;
  readonly userId: string;
}

export type ApprovalNoticeReader = (read: ApprovalNoticeRead) => Promise<void>;

export function createApprovalNoticeReader(deps: ApprovalNotifierDeps): ApprovalNoticeReader {
  const now = deps.now ?? (() => new Date());
  return (read) =>
    deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", read.userId);
      await tx
        .update(notifications)
        .set({ readAt: now() })
        .where(
          and(
            eq(notifications.userId, read.userId),
            eq(notifications.communityId, read.communityId),
            eq(notifications.subjectType, "approval_request"),
            eq(notifications.subjectId, read.approvalId),
            isNull(notifications.readAt),
          ),
        );
    });
}

let defaultNotifier: ApprovalNotifier | undefined;
let defaultReader: ApprovalNoticeReader | undefined;

export function getApprovalNoticeReader(): ApprovalNoticeReader {
  defaultReader ??= createApprovalNoticeReader({ db: getDb() });
  return defaultReader;
}

export function getApprovalNotifier(): ApprovalNotifier {
  defaultNotifier ??= createApprovalNotifier({ db: getDb() });
  return defaultNotifier;
}
