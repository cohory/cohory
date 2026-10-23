import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import { getDb, type Database, type Transaction } from "@cohory/db";
import {
  accountAuditLog,
  comments,
  communities,
  creatorFeedback,
  eventOccurrences,
  eventRsvps,
  events,
  lessonProgress,
  lessons,
  memberStats,
  memberships,
  notificationPreferences,
  notificationSettings,
  posts,
  users,
} from "@cohory/db/schema";
import { listMyPaidMemberships, type PaidMembershipRow } from "@cohory/payments/account";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { strToU8, Zip, ZipDeflate } from "fflate";
import { z } from "zod";

import { DataExportNotFoundError, DataExportRateLimitedError } from "./errors";
import { actAsUser, audit } from "./queries";

export const dataExportRequestedAction = "account.data_export_requested";
export const dataExportDownloadedAction = "account.data_export_downloaded";
export const dataExportLinkDays = 7;
export const dataExportCooldownHours = 24;

const hourMs = 60 * 60 * 1000;
const linkMs = dataExportLinkDays * 24 * hourMs;
const cooldownMs = dataExportCooldownHours * hourMs;

export interface DataExportLink {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly exportId: string;
  readonly expiresAt: Date;
}

export interface DataExportRequest {
  readonly exportId: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
}

export interface RequestedDataExport extends DataExportRequest {
  readonly emailed: boolean;
}

export interface DataExportFile {
  readonly filename: string;
  readonly stream: ReadableStream<Uint8Array>;
}

export interface DataExportDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly pageSize?: number;
  readonly sendLink: (link: DataExportLink) => Promise<void>;
  readonly listPaidMemberships?: (actor: Actor) => Promise<PaidMembershipRow[]>;
}

function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  assertCan(actor, "update_own", "account");
  return actor.userId;
}

const exportIdSchema = z.uuid();

async function latestRequest(tx: Transaction, userId: string): Promise<DataExportRequest | null> {
  const [row] = await tx
    .select({ id: accountAuditLog.id, createdAt: accountAuditLog.createdAt })
    .from(accountAuditLog)
    .where(
      and(
        eq(accountAuditLog.userId, userId),
        eq(accountAuditLog.action, dataExportRequestedAction),
      ),
    )
    .orderBy(desc(accountAuditLog.createdAt))
    .limit(1);
  return row
    ? {
        exportId: row.id,
        requestedAt: row.createdAt,
        expiresAt: new Date(row.createdAt.getTime() + linkMs),
      }
    : null;
}

async function accountData(tx: Transaction, userId: string) {
  const [profile] = await tx
    .select({
      name: users.name,
      email: users.email,
      username: users.username,
      image: users.image,
      emailVerified: users.emailVerified,
      termsVersion: users.termsVersion,
      termsAcceptedAt: users.termsAcceptedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const [settings] = await tx
    .select({
      digestHour: notificationSettings.digestHour,
      timeZone: notificationSettings.timeZone,
      weeklyDigest: notificationSettings.weeklyDigest,
      creatorFeedbackOptedOutAt: notificationSettings.creatorFeedbackOptedOutAt,
    })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  const preferences = await tx
    .select({
      type: notificationPreferences.type,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const joined = await tx
    .select({
      communityId: memberships.communityId,
      slug: communities.slug,
      name: communities.name,
      role: memberships.role,
      status: memberships.status,
      bio: memberships.bio,
      joinAnswers: memberships.joinAnswers,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(communities, eq(communities.id, memberships.communityId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(communities.name));
  const feedback = await tx
    .select({
      kind: creatorFeedback.kind,
      topic: creatorFeedback.topic,
      status: creatorFeedback.status,
      score: creatorFeedback.score,
      reason: creatorFeedback.reason,
      comment: creatorFeedback.comment,
      community: communities.slug,
      createdAt: creatorFeedback.createdAt,
      respondedAt: creatorFeedback.respondedAt,
    })
    .from(creatorFeedback)
    .leftJoin(communities, eq(communities.id, creatorFeedback.communityId))
    .where(eq(creatorFeedback.userId, userId))
    .orderBy(asc(creatorFeedback.createdAt));
  return {
    profile: profile ?? null,
    notifications: { settings: settings ?? null, preferences },
    joined,
    feedback,
  };
}

async function communityDetails(tx: Transaction, communityId: string, userId: string) {
  const rsvps = await tx
    .select({
      event: events.title,
      startsAt: eventOccurrences.startsAt,
      status: eventRsvps.status,
    })
    .from(eventRsvps)
    .innerJoin(eventOccurrences, eq(eventOccurrences.id, eventRsvps.occurrenceId))
    .innerJoin(events, eq(events.id, eventOccurrences.eventId))
    .where(and(eq(eventRsvps.communityId, communityId), eq(eventRsvps.userId, userId)))
    .orderBy(asc(eventOccurrences.startsAt));
  const progress = await tx
    .select({
      lesson: lessons.title,
      completedAt: lessonProgress.completedAt,
      lastViewedAt: lessonProgress.lastViewedAt,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
    .where(and(eq(lessonProgress.communityId, communityId), eq(lessonProgress.userId, userId)))
    .orderBy(asc(lessonProgress.lastViewedAt));
  const [points] = await tx
    .select({ points: memberStats.pointsTotal, level: memberStats.level })
    .from(memberStats)
    .where(and(eq(memberStats.communityId, communityId), eq(memberStats.userId, userId)));
  return { rsvps, courseProgress: progress, points: points ?? null };
}

function activityPage(tx: Transaction, userId: string, after: string | null, limit: number) {
  return tx
    .select({
      id: accountAuditLog.id,
      action: accountAuditLog.action,
      createdAt: accountAuditLog.createdAt,
    })
    .from(accountAuditLog)
    .where(
      and(eq(accountAuditLog.userId, userId), after ? gt(accountAuditLog.id, after) : undefined),
    )
    .orderBy(asc(accountAuditLog.id))
    .limit(limit);
}

interface Page {
  readonly tx: Transaction;
  readonly communityId: string;
  readonly userId: string;
  readonly after: string | null;
  readonly limit: number;
}

function postsPage({ tx, communityId, userId, after, limit }: Page) {
  return tx
    .select({
      id: posts.id,
      title: posts.title,
      text: posts.bodyText,
      createdAt: posts.createdAt,
      editedAt: posts.editedAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.communityId, communityId),
        eq(posts.authorId, userId),
        isNull(posts.deletedAt),
        after ? gt(posts.id, after) : undefined,
      ),
    )
    .orderBy(asc(posts.id))
    .limit(limit);
}

function commentsPage({ tx, communityId, userId, after, limit }: Page) {
  return tx
    .select({
      id: comments.id,
      postId: comments.postId,
      text: comments.bodyText,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.communityId, communityId),
        eq(comments.authorId, userId),
        isNull(comments.deletedAt),
        after ? gt(comments.id, after) : undefined,
      ),
    )
    .orderBy(asc(comments.id))
    .limit(limit);
}

const readme = `This file holds a copy of your account data.

profile.json: your account and notification settings.
activity.json: your account activity, such as sign ins, changes, and data export requests.
billing.json: your paid memberships.
feedback.json: your answers to setup questions and the reasons you gave for leaving, if any.
communities/<address>.json: your membership, posts, comments, RSVPs, course progress, and points in each community.

Posts and comments by other people are not included.
Not included: reactions, notifications, uploaded files, and API tokens.
`;

interface ZipPiece {
  readonly file: string;
  readonly text: string;
  readonly last: boolean;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function zipStream(pieces: AsyncGenerator<ZipPiece>): ReadableStream<Uint8Array> {
  const pending: Uint8Array[] = [];
  let finished = false;
  let failure: Error | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    pending.push(chunk);
    finished = final;
  });
  let open: ZipDeflate | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (pending.length === 0 && !finished && !failure) {
        const next = await pieces.next();
        if (next.done) {
          zip.end();
          break;
        }
        const { file, text, last } = next.value;
        open ??= startFile(zip, file);
        open.push(strToU8(text), last);
        if (last) {
          open = null;
        }
      }
      if (failure) {
        controller.error(failure);
        return;
      }
      for (const chunk of pending.splice(0)) {
        controller.enqueue(chunk);
      }
      if (finished) {
        controller.close();
      }
    },
    async cancel() {
      await pieces.return(undefined);
    },
  });
}

function startFile(zip: Zip, name: string): ZipDeflate {
  const file = new ZipDeflate(name, { level: 6 });
  zip.add(file);
  return file;
}

export function createDataExportService(deps: DataExportDeps) {
  const now = deps.now ?? (() => new Date());
  const paid = deps.listPaidMemberships ?? listMyPaidMemberships;
  const pageSize = deps.pageSize ?? 500;

  function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>, communityId?: string) {
    return deps.db.transaction(async (tx) => {
      await actAsUser(tx, userId, communityId);
      return fn(tx);
    });
  }

  return {
    async latestExport(actor: Actor): Promise<DataExportRequest | null> {
      const userId = requireUserId(actor);
      return asUser(userId, (tx) => latestRequest(tx, userId));
    },

    async requestExport(actor: Actor): Promise<RequestedDataExport> {
      const userId = requireUserId(actor);
      const { request, user } = await asUser(userId, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`data-export:${userId}`}, 0))`,
        );
        const at = now();
        const previous = await latestRequest(tx, userId);
        if (previous && at.getTime() - previous.requestedAt.getTime() < cooldownMs) {
          throw new DataExportRateLimitedError(
            new Date(previous.requestedAt.getTime() + cooldownMs),
          );
        }
        const [user] = await tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.erasedAt)));
        if (!user) {
          throw new DataExportNotFoundError();
        }
        await audit(tx, userId, dataExportRequestedAction, null, at);
        const recorded = await latestRequest(tx, userId);
        if (!recorded) {
          throw new DataExportNotFoundError();
        }
        return { request: recorded, user };
      });
      try {
        await deps.sendLink({
          userId,
          email: user.email,
          name: user.name,
          exportId: request.exportId,
          expiresAt: request.expiresAt,
        });
      } catch {
        return { ...request, emailed: false };
      }
      return { ...request, emailed: true };
    },

    async openExport(actor: Actor, exportId: string): Promise<DataExportFile> {
      const userId = requireUserId(actor);
      const id = exportIdSchema.safeParse(exportId);
      if (!id.success) {
        throw new DataExportNotFoundError();
      }
      const at = now();
      const account = await asUser(userId, async (tx) => {
        const [request] = await tx
          .select({ id: accountAuditLog.id })
          .from(accountAuditLog)
          .where(
            and(
              eq(accountAuditLog.id, id.data),
              eq(accountAuditLog.userId, userId),
              eq(accountAuditLog.action, dataExportRequestedAction),
              gt(accountAuditLog.createdAt, new Date(at.getTime() - linkMs)),
            ),
          );
        if (!request) {
          throw new DataExportNotFoundError();
        }
        await audit(tx, userId, dataExportDownloadedAction, { exportId: id.data }, at);
        return accountData(tx, userId);
      });

      async function* paged<Row extends { id: string }>(
        file: string,
        read: (after: string | null) => Promise<Row[]>,
        present: (row: Row) => unknown = (row) => row,
      ): AsyncGenerator<ZipPiece> {
        let after: string | null = null;
        let first = true;
        for (;;) {
          const rows: Row[] = await read(after);
          if (rows.length > 0) {
            const text = rows.map((row) => JSON.stringify(present(row))).join(",\n");
            yield { file, text: first ? text : `,\n${text}`, last: false };
            first = false;
          }
          const last = rows.at(-1);
          if (rows.length < pageSize || !last) {
            return;
          }
          after = last.id;
        }
      }

      function inCommunity<Row>(communityId: string, read: (page: Page) => Promise<Row[]>) {
        return (after: string | null) =>
          asUser(
            userId,
            (tx) => read({ tx, communityId, userId, after, limit: pageSize }),
            communityId,
          );
      }

      async function* pieces(): AsyncGenerator<ZipPiece> {
        yield { file: "README.txt", text: readme, last: true };
        yield {
          file: "profile.json",
          text: json({ ...account.profile, notifications: account.notifications }),
          last: true,
        };
        yield { file: "activity.json", text: "[\n", last: false };
        yield* paged(
          "activity.json",
          (after) => asUser(userId, (tx) => activityPage(tx, userId, after, pageSize)),
          ({ action, createdAt }) => ({ action, createdAt }),
        );
        yield { file: "activity.json", text: "\n]\n", last: true };
        yield { file: "billing.json", text: json(await paid(actor)), last: true };
        yield { file: "feedback.json", text: json(account.feedback), last: true };
        for (const membership of account.joined) {
          const file = `communities/${membership.slug}.json`;
          const details = await asUser(
            userId,
            (tx) => communityDetails(tx, membership.communityId, userId),
            membership.communityId,
          );
          const head = {
            community: { name: membership.name, slug: membership.slug },
            membership: {
              role: membership.role,
              status: membership.status,
              bio: membership.bio,
              joinAnswers: membership.joinAnswers,
              joinedAt: membership.joinedAt,
            },
            ...details,
          };
          const fields = Object.entries(head).map(
            ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
          );
          yield { file, text: `{\n${fields.join(",\n")},\n"posts": [\n`, last: false };
          yield* paged(file, inCommunity(membership.communityId, postsPage));
          yield { file, text: `\n],\n"comments": [\n`, last: false };
          yield* paged(file, inCommunity(membership.communityId, commentsPage));
          yield { file, text: "\n]\n}\n", last: true };
        }
      }

      return {
        filename: `data-export-${at.toISOString().slice(0, 10)}.zip`,
        stream: zipStream(pieces()),
      };
    },
  };
}

export type DataExportService = ReturnType<typeof createDataExportService>;

let defaultService: DataExportService | undefined;

export function getDataExportService(
  sendLink: (link: DataExportLink) => Promise<void>,
): DataExportService {
  defaultService ??= createDataExportService({ db: getDb(), sendLink });
  return defaultService;
}
