import { randomBytes } from "node:crypto";

import { newId, type Community } from "@cohory/db";
import {
  accounts,
  inviteLinks,
  memberships,
  migrationIdMap,
  users,
  type MigrationJob,
} from "@cohory/db/schema";
import {
  communityMovedEmail,
  hashEmailAddress,
  memberInvitedEmail,
  type CommunityMove,
  type EmailContent,
  type FirstContactOrigin,
} from "@cohory/email";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { inviteLifetimeDays } from "./csv/members";
import { importEmailsPerDay } from "./config";
import { MigrationError, MigrationNotFoundError } from "./errors";
import { IdMap, parsePlaceholderEmailKey } from "./import/id-map";
import { passwordLink } from "./password-link";
import type { ImportSummary } from "./import/summary";
import {
  emailBrandOf,
  firstContactMail,
  loadCommunity,
  memberLimits,
  userName,
  type Runtime,
} from "./runtime";
import { inMigrationScope } from "./scope";
import type { ImportPreview } from "./views";

const dayMs = 24 * 60 * 60 * 1000;

const movedLabels: readonly (readonly [string, string])[] = [
  ["posts", "posts"],
  ["comments", "comments"],
  ["courses", "courses"],
  ["events", "events"],
  ["points_ledger", "points"],
];

export interface ImportEmailContext {
  readonly community: Community;
  readonly move: CommunityMove;
  readonly moved: readonly string[];
  readonly note: string | null;
}

interface Recipient {
  readonly kind: "moved" | "invited";
  readonly sourceUserId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export type Delivery = "sent" | "suppressed";

function originOf(job: MigrationJob): FirstContactOrigin {
  if (job.kind === "members_csv") return { kind: "list" };
  const source = (job.preview as ImportPreview | null)?.source;
  return source ? { kind: "platform", name: source.name } : { kind: "archive" };
}

function movedItems(job: MigrationJob): string[] {
  const counts =
    (job.summary as ImportSummary | null)?.imported ??
    (job.preview as ImportPreview | null)?.counts ??
    {};
  return movedLabels.flatMap(([entity, label]) => ((counts[entity] ?? 0) > 0 ? [label] : []));
}

export function noteOf(options: Record<string, unknown> | null): string | null {
  const note = options?.["note"];
  return typeof note === "string" && note.trim() !== "" ? note : null;
}

export async function importEmailContext(
  runtime: Runtime,
  job: MigrationJob,
  note: string | null = noteOf(job.options),
): Promise<ImportEmailContext> {
  const community = await loadCommunity(runtime, job.communityId);
  const inviterName =
    (job.requestedBy ? await userName(runtime, community.id, job.requestedBy) : null) ??
    community.name;
  return {
    community,
    move: { inviterName, origin: originOf(job) },
    moved: job.kind === "members_csv" ? [] : movedItems(job),
    note,
  };
}

export function importEmailContent(
  runtime: Runtime,
  context: ImportEmailContext,
  input: { kind: Recipient["kind"]; to: string; name: string; url: string },
): { content: EmailContent; envelope: ReturnType<typeof firstContactMail>["envelope"] } {
  const { community } = context;
  const { firstContact, envelope } = firstContactMail(runtime, {
    to: input.to,
    communityId: community.id,
    inviterName: context.move.inviterName,
    origin: context.move.origin,
  });
  const shared = {
    name: input.name,
    communityName: community.name,
    communityBrand: emailBrandOf(runtime, community),
    url: input.url,
    move: context.move,
    moved: context.moved,
    note: context.note,
    ...(firstContact ? { firstContact } : {}),
  };
  return {
    content: input.kind === "moved" ? communityMovedEmail(shared) : memberInvitedEmail(shared),
    envelope,
  };
}

export async function userEmail(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<string | null> {
  return (await namesOf(runtime, communityId, [userId])).get(userId)?.email ?? null;
}

const sampleAddress = "member@example.com";

export async function sampleImportEmail(
  runtime: Runtime,
  job: MigrationJob,
  actorId: string,
  note: string | null,
): Promise<EmailContent> {
  const context = await importEmailContext(runtime, job, note);
  const kind =
    job.kind === "members_csv" || runtime.fairUse.edition === "cloud" ? "invited" : "moved";
  return importEmailContent(runtime, context, {
    kind,
    to: sampleAddress,
    name: (await userName(runtime, job.communityId, actorId)) ?? "",
    url: `${runtime.config.appUrl}/c/${encodeURIComponent(context.community.slug)}`,
  }).content;
}

async function usableInviteToken(
  runtime: Runtime,
  communityId: string,
  linkId: string,
): Promise<string | null> {
  const [link] = await inMigrationScope(runtime.db, communityId, ({ tx, where }) =>
    tx
      .select({ token: inviteLinks.token })
      .from(inviteLinks)
      .where(
        where(
          inviteLinks,
          eq(inviteLinks.id, linkId),
          isNull(inviteLinks.revokedAt),
          or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, runtime.now())),
          or(isNull(inviteLinks.maxUses), lt(inviteLinks.useCount, inviteLinks.maxUses)),
        ),
      ),
  );
  return link?.token ?? null;
}

async function placeholderInviteUrl(
  runtime: Runtime,
  job: MigrationJob,
  map: IdMap,
  sourceUserId: string,
  actorId: string,
): Promise<string> {
  const linkId = map.get("placeholder_invite", sourceUserId);
  const token = linkId ? await usableInviteToken(runtime, job.communityId, linkId) : null;
  if (token) return `${runtime.config.appUrl}/join/${token}`;
  const id = newId();
  const created = randomBytes(32).toString("base64url");
  await inMigrationScope(runtime.db, job.communityId, async ({ tx }) => {
    await tx.insert(inviteLinks).values({
      id,
      communityId: job.communityId,
      token: created,
      createdBy: actorId,
      expiresAt: new Date(runtime.now().getTime() + inviteLifetimeDays * dayMs),
      maxUses: 1,
    });
    await tx
      .insert(migrationIdMap)
      .values({
        communityId: job.communityId,
        jobId: job.id,
        entity: "placeholder_invite",
        sourceId: sourceUserId,
        targetId: id,
      })
      .onConflictDoUpdate({
        target: [
          migrationIdMap.communityId,
          migrationIdMap.jobId,
          migrationIdMap.entity,
          migrationIdMap.sourceId,
        ],
        set: { targetId: id },
      });
  });
  map.assign("placeholder_invite", sourceUserId, id);
  return `${runtime.config.appUrl}/join/${created}`;
}

async function withPassword(
  runtime: Runtime,
  communityId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await inMigrationScope(runtime.db, communityId, ({ tx }) =>
    tx
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(inArray(accounts.userId, [...userIds]), eq(accounts.providerId, "credential"))),
  );
  return new Set(rows.map((row) => row.userId));
}

async function activeMembers(
  runtime: Runtime,
  communityId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await inMigrationScope(runtime.db, communityId, ({ tx, where }) =>
    tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        where(
          memberships,
          inArray(memberships.userId, [...userIds]),
          eq(memberships.status, "active"),
        ),
      ),
  );
  return new Set(rows.map((row) => row.userId));
}

async function namesOf(
  runtime: Runtime,
  communityId: string,
  userIds: readonly string[],
): Promise<Map<string, { email: string; name: string }>> {
  if (userIds.length === 0) return new Map();
  const rows = await inMigrationScope(runtime.db, communityId, ({ tx }) =>
    tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.id, [...userIds])),
  );
  return new Map(rows.map((row) => [row.id, { email: row.email, name: row.name }]));
}

async function acceptedPlaceholders(
  runtime: Runtime,
  communityId: string,
  map: IdMap,
): Promise<Set<string>> {
  const links = map.entries("placeholder_invite");
  if (links.length === 0) return new Set();
  const used = await inMigrationScope(runtime.db, communityId, ({ tx, where }) =>
    tx
      .select({ id: inviteLinks.id })
      .from(inviteLinks)
      .where(
        where(
          inviteLinks,
          inArray(
            inviteLinks.id,
            links.map((link) => link.targetId),
          ),
          sql`${inviteLinks.useCount} >= coalesce(${inviteLinks.maxUses}, 1)`,
        ),
      ),
  );
  const usedIds = new Set(used.map((row) => row.id));
  return new Set(links.filter((link) => usedIds.has(link.targetId)).map((link) => link.sourceId));
}

async function recipients(runtime: Runtime, job: MigrationJob, map: IdMap): Promise<Recipient[]> {
  const created = map.entries("users_created");
  const placeholders = map
    .entries("placeholder_email")
    .map((entry) => ({ ...parsePlaceholderEmailKey(entry.sourceId), userId: entry.targetId }));
  const ids = [...created.map((entry) => entry.targetId), ...placeholders.map((p) => p.userId)];
  const people = await namesOf(runtime, job.communityId, ids);
  const members = await activeMembers(
    runtime,
    job.communityId,
    created.map((entry) => entry.targetId),
  );
  const signedUp = await withPassword(
    runtime,
    job.communityId,
    created.map((entry) => entry.targetId),
  );
  const accepted = await acceptedPlaceholders(runtime, job.communityId, map);
  const result: Recipient[] = [];
  for (const entry of created) {
    const person = people.get(entry.targetId);
    if (!person || !members.has(entry.targetId) || signedUp.has(entry.targetId)) continue;
    result.push({
      kind: "moved",
      sourceUserId: entry.sourceId,
      userId: entry.targetId,
      email: person.email,
      name: person.name,
    });
  }
  for (const placeholder of placeholders) {
    if (!map.has("placeholder_member", placeholder.sourceUserId)) continue;
    if (accepted.has(placeholder.sourceUserId)) continue;
    result.push({
      kind: "invited",
      sourceUserId: placeholder.sourceUserId,
      userId: placeholder.userId,
      email: placeholder.email,
      name: people.get(placeholder.userId)?.name ?? "",
    });
  }
  return result;
}

async function deliver(
  runtime: Runtime,
  job: MigrationJob,
  map: IdMap,
  context: ImportEmailContext,
  recipient: Recipient,
  actorId: string,
): Promise<Delivery> {
  if (!runtime.mailer) return "suppressed";
  const suppressed = await runtime.suppression?.isSuppressed({
    addressHash: hashEmailAddress(recipient.email),
    communityId: job.communityId,
  });
  if (suppressed) return "suppressed";
  const url =
    recipient.kind === "moved"
      ? await passwordLink(runtime, context.community, recipient.userId)
      : await placeholderInviteUrl(runtime, job, map, recipient.sourceUserId, actorId);
  const { content, envelope } = importEmailContent(runtime, context, {
    kind: recipient.kind,
    to: recipient.email,
    name: recipient.name,
    url,
  });
  await runtime.mailer.send({ to: recipient.email, ...envelope, ...content });
  return "sent";
}

async function remember(runtime: Runtime, map: IdMap, entity: string, sourceId: string) {
  await inMigrationScope(runtime.db, map.communityId, async ({ tx }) => {
    await map.persist(tx, [map.assign(entity, sourceId)]);
  });
}

export interface ImportEmailCounts {
  readonly sent: number;
  readonly notSent: number;
  readonly overLimit: number;
  readonly sentNow: number;
  readonly day: string;
  readonly deferred: boolean;
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function nextUtcDay(at: Date): Date {
  return new Date(Date.parse(`${utcDay(at)}T00:00:00.000Z`) + dayMs);
}

function emailsByDay(job: MigrationJob): Readonly<Record<string, number>> {
  return (job.summary as ImportSummary | null)?.emailsByDay ?? {};
}

async function emailsLeftToday(runtime: Runtime, communityId: string, day: string) {
  const perDay = runtime.config.importEmailsPerDay ?? importEmailsPerDay;
  const used = (await runtime.jobs.list(communityId)).reduce(
    (total, job) => total + (emailsByDay(job)[day] ?? 0),
    0,
  );
  return Math.max(0, perDay - used);
}

// On Cloud an import may not email more people than the plan could ever hold as members, so a
// free community cannot be used to send invitations to an arbitrary list.
async function recipientCap(runtime: Runtime, communityId: string): Promise<number | null> {
  if (runtime.fairUse.edition !== "cloud") return null;
  return (await memberLimits(runtime, await loadCommunity(runtime, communityId))).members;
}

interface Allowed {
  readonly handled: readonly Recipient[];
  readonly pending: readonly Recipient[];
  readonly overLimit: number;
}

async function allowedRecipients(runtime: Runtime, job: MigrationJob, map: IdMap) {
  const all = await recipients(runtime, job, map);
  const done = (recipient: Recipient) =>
    map.has("moved_email", recipient.sourceUserId) ||
    map.has("moved_email_suppressed", recipient.sourceUserId);
  const cap = await recipientCap(runtime, job.communityId);
  const handledBefore = map.count("moved_email") + map.count("moved_email_suppressed");
  const waiting = all.filter((recipient) => !done(recipient));
  const room = cap === null ? waiting.length : Math.max(0, cap - handledBefore);
  return {
    handled: all.filter(done),
    pending: waiting.slice(0, room),
    overLimit: waiting.length - Math.min(room, waiting.length),
  } satisfies Allowed;
}

export function withEmailCounts(summary: ImportSummary, counts: ImportEmailCounts): ImportSummary {
  const byDay = summary.emailsByDay ?? {};
  return {
    ...summary,
    emailsSent: counts.sent,
    emailsNotSent: counts.notSent,
    emailsOverLimit: counts.overLimit,
    emailsByDay:
      counts.sentNow > 0
        ? { ...byDay, [counts.day]: (byDay[counts.day] ?? 0) + counts.sentNow }
        : byDay,
  };
}

export async function sendImportEmails(
  runtime: Runtime,
  job: MigrationJob,
  actorId: string,
): Promise<ImportEmailCounts> {
  const map = await IdMap.load(runtime.db, job.communityId, job.id);
  const day = utcDay(runtime.now());
  let sentNow = 0;
  let deferred = false;
  let overLimit = 0;
  if (runtime.mailer) {
    const context = await importEmailContext(runtime, job);
    const allowed = await allowedRecipients(runtime, job, map);
    overLimit = allowed.overLimit;
    let left = await emailsLeftToday(runtime, job.communityId, day);
    for (const recipient of allowed.pending) {
      if (left <= 0) {
        deferred = true;
        break;
      }
      const delivery = await deliver(runtime, job, map, context, recipient, actorId);
      await remember(
        runtime,
        map,
        delivery === "sent" ? "moved_email" : "moved_email_suppressed",
        recipient.sourceUserId,
      );
      if (delivery === "sent") {
        sentNow += 1;
        left -= 1;
      }
    }
  }
  return {
    sent: map.count("moved_email"),
    notSent: map.count("moved_email_suppressed"),
    overLimit,
    sentNow,
    day,
    deferred,
  };
}

async function importJobsOf(runtime: Runtime, communityId: string): Promise<MigrationJob[]> {
  return (await runtime.jobs.list(communityId)).filter(
    (job) => job.kind === "import" && job.status === "succeeded",
  );
}

async function resendable(runtime: Runtime, job: MigrationJob, map: IdMap) {
  const allowed = await allowedRecipients(runtime, job, map);
  return [...allowed.handled, ...allowed.pending];
}

export async function resendableUserIds(runtime: Runtime, communityId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const job of await importJobsOf(runtime, communityId)) {
    const map = await IdMap.load(runtime.db, communityId, job.id);
    ids.push(...(await resendable(runtime, job, map)).map((recipient) => recipient.userId));
  }
  return ids;
}

export async function resendImportEmail(
  runtime: Runtime,
  communityId: string,
  userId: string,
  actorId: string,
): Promise<Delivery> {
  for (const job of await importJobsOf(runtime, communityId)) {
    const map = await IdMap.load(runtime.db, communityId, job.id);
    const recipient = (await resendable(runtime, job, map)).find(
      (candidate) => candidate.userId === userId,
    );
    if (!recipient) continue;
    const day = utcDay(runtime.now());
    if ((await emailsLeftToday(runtime, communityId, day)) <= 0) {
      throw new MigrationError(
        "daily_email_limit",
        "This community sent as many import emails as it can today. Try again tomorrow.",
      );
    }
    const context = await importEmailContext(runtime, job);
    const delivery = await deliver(runtime, job, map, context, recipient, actorId);
    if (delivery === "sent") {
      if (!map.has("moved_email", recipient.sourceUserId)) {
        await remember(runtime, map, "moved_email", recipient.sourceUserId);
      }
      const summary = job.summary as ImportSummary | null;
      if (summary) {
        const byDay = summary.emailsByDay ?? {};
        await runtime.jobs.update(communityId, job.id, {
          summary: { ...summary, emailsByDay: { ...byDay, [day]: (byDay[day] ?? 0) + 1 } },
        });
      }
    }
    return delivery;
  }
  throw new MigrationNotFoundError("member");
}
