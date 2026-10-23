import {
  getDb,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type CommunityScope,
  type Database,
} from "@cohory/db";
import { communities, memberships, posts, users } from "@cohory/db/schema";
import {
  communityEmailBrand,
  createOptOutLinker,
  memberAnnouncementEmail,
  optOutSecretFromEnv,
  sendEmail,
  type EmailMessage,
  type OptOutLinker,
} from "@cohory/email";
import { communityAccessIn } from "@cohory/entitlements/access";
import { asc, eq, gt, isNull, ne } from "drizzle-orm";

import type { PostEvents } from "./events";

export type MemberEmailJobInput = PostEvents["post.emailed"];

export interface MemberEmailJobDeps {
  readonly db: Database;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly optOut: OptOutLinker;
  readonly appUrl: string;
  readonly now?: () => Date;
  readonly pageSize?: number;
  readonly onError?: (error: unknown) => void;
}

export interface MemberEmailRunResult {
  readonly sent: number;
  readonly failed: number;
  readonly skipped: boolean;
  readonly stopped: boolean;
}

export interface MemberEmailRunOptions {
  readonly signal?: AbortSignal;
}

export class MemberEmailInterruptedError extends Error {
  constructor(
    readonly sent: number,
    readonly failed: number,
    cause: unknown,
  ) {
    super("the member email run broke off", { cause });
    this.name = "MemberEmailInterruptedError";
  }
}

interface Recipient {
  readonly userId: string;
  readonly email: string;
}

interface Announcement {
  readonly communityName: string;
  readonly slug: string;
  readonly appearance: Parameters<typeof communityEmailBrand>[0];
  readonly authorName: string;
  readonly title: string | null;
  readonly bodyText: string;
}

async function loadAnnouncement(
  scope: CommunityScope,
  postId: string,
): Promise<Announcement | null> {
  return runInCommunity(scope, async ({ tx, where }) => {
    const [row] = await tx
      .select({
        communityName: communities.name,
        slug: communities.slug,
        appearance: communities.appearance,
        authorName: users.name,
        title: posts.title,
        bodyText: posts.bodyText,
      })
      .from(posts)
      .innerJoin(communities, eq(communities.id, posts.communityId))
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(
        where(
          posts,
          eq(posts.id, postId),
          isNull(posts.deletedAt),
          isNull(posts.scheduledAt),
          isNull(communities.deletedAt),
          isNull(communities.archivedAt),
        ),
      );
    return row ?? null;
  });
}

async function recipientsPage(
  scope: CommunityScope,
  input: MemberEmailJobInput,
  after: string | null,
  limit: number,
  at: Date,
): Promise<{ readonly recipients: Recipient[]; readonly last: string | null }> {
  return runInCommunity(scope, async (queries) => {
    const rows = await queries.tx
      .select({ userId: memberships.userId, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        queries.where(
          memberships,
          eq(memberships.status, "active"),
          ne(memberships.userId, input.sentBy),
          after ? gt(memberships.userId, after) : undefined,
          eq(users.emailVerified, true),
          isNull(users.erasedAt),
          isNull(users.deletionScheduledFor),
        ),
      )
      .orderBy(asc(memberships.userId))
      .limit(limit);
    const recipients: Recipient[] = [];
    for (const row of rows) {
      if ((await communityAccessIn(queries, row.userId, at)).entitled) {
        recipients.push(row);
      }
    }
    return { recipients, last: rows.at(-1)?.userId ?? null };
  });
}

export function createMemberEmailJob(deps: MemberEmailJobDeps) {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");
  const pageSize = deps.pageSize ?? 200;

  return async function sendMemberEmail(
    input: MemberEmailJobInput,
    options: MemberEmailRunOptions = {},
  ): Promise<MemberEmailRunResult> {
    const scope = withCommunity(deps.db, parseCommunityId(input.communityId));
    const announcement = await loadAnnouncement(scope, input.postId);
    if (!announcement) {
      return { sent: 0, failed: 0, skipped: true, stopped: false };
    }
    const content = (to: string) => {
      const links = deps.optOut({ to, communityId: input.communityId });
      return {
        headers: links.headers,
        ...memberAnnouncementEmail({
          communityName: announcement.communityName,
          communityBrand: communityEmailBrand(announcement.appearance),
          authorName: announcement.authorName,
          title: announcement.title,
          bodyText: announcement.bodyText,
          postUrl: `${appUrl}/c/${encodeURIComponent(announcement.slug)}/posts/${input.postId}`,
          optOutUrl: links.url,
        }),
      };
    };
    let sent = 0;
    let failed = 0;
    let after: string | null = null;
    const at = now();
    try {
      for (;;) {
        const page = await recipientsPage(scope, input, after, pageSize, at);
        for (const recipient of page.recipients) {
          if (options.signal?.aborted) {
            return { sent, failed, skipped: false, stopped: true };
          }
          try {
            await deps.send({
              to: recipient.email,
              communityId: input.communityId,
              ...content(recipient.email),
            });
            sent += 1;
          } catch (error: unknown) {
            failed += 1;
            deps.onError?.(error);
          }
        }
        if (!page.last) {
          return { sent, failed, skipped: false, stopped: false };
        }
        if (options.signal?.aborted) {
          return { sent, failed, skipped: false, stopped: true };
        }
        after = page.last;
      }
    } catch (error: unknown) {
      throw new MemberEmailInterruptedError(sent, failed, error);
    }
  };
}

export type SendMemberEmail = ReturnType<typeof createMemberEmailJob>;

let defaultJob: SendMemberEmail | undefined;

export function getMemberEmailJob(
  appUrl: string,
  onError: (error: unknown) => void,
): SendMemberEmail {
  defaultJob ??= createMemberEmailJob({
    db: getDb(),
    send: sendEmail,
    optOut: createOptOutLinker({ secret: optOutSecretFromEnv(), appUrl }),
    appUrl,
    onError,
  });
  return defaultJob;
}
