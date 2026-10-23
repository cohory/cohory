import { randomBytes } from "node:crypto";

import { newId, type Community } from "@cohory/db";
import { accounts, inviteLinks, memberships, migrationIdMap, users } from "@cohory/db/schema";
import {
  hashEmailAddress,
  memberAddedEmail,
  memberInvitedEmail,
  type EmailMessage,
} from "@cohory/email";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { IdMap } from "../import/id-map";
import {
  activeMemberCount,
  emailBrandOf,
  firstContactMail,
  memberLimits,
  userName,
  type Runtime,
} from "../runtime";
import { inMigrationScope } from "../scope";
import type {
  MembersCsvPreview,
  MembersCsvPreviewRow,
  MembersImportMode,
  MembersImportSummary,
  MembersSkippedRow,
} from "../views";
import { passwordLink } from "../password-link";
import type { CsvMemberRow, ParsedMembersCsv } from "./parse";

export const inviteLifetimeDays = 30;
const batchSize = 200;
const dayMs = 24 * 60 * 60 * 1000;

interface ExistingPerson {
  readonly userId: string;
  readonly membershipStatus: string | null;
}

async function lookup(
  runtime: Runtime,
  communityId: string,
  emails: readonly string[],
): Promise<Map<string, ExistingPerson>> {
  const found = new Map<string, ExistingPerson>();
  for (let start = 0; start < emails.length; start += 1000) {
    const slice = emails.slice(start, start + 1000);
    const rows = await inMigrationScope(runtime.db, communityId, ({ tx }) =>
      tx
        .select({ id: users.id, email: users.email, status: memberships.status })
        .from(users)
        .leftJoin(
          memberships,
          and(eq(memberships.userId, users.id), eq(memberships.communityId, communityId)),
        )
        .where(inArray(sql`lower(${users.email}::text)`, slice)),
    );
    for (const row of rows) {
      found.set(row.email.toLowerCase(), { userId: row.id, membershipStatus: row.status });
    }
  }
  return found;
}

async function openInvites(runtime: Runtime, communityId: string): Promise<Map<string, Date>> {
  const rows = await inMigrationScope(runtime.db, communityId, ({ tx, where }) =>
    tx
      .select({ sourceId: migrationIdMap.sourceId, createdAt: inviteLinks.createdAt })
      .from(migrationIdMap)
      .innerJoin(
        inviteLinks,
        and(
          eq(inviteLinks.id, migrationIdMap.targetId),
          eq(inviteLinks.communityId, migrationIdMap.communityId),
        ),
      )
      .where(
        where(
          migrationIdMap,
          inArray(migrationIdMap.entity, ["csv_rows", "csv_invites"]),
          isNull(inviteLinks.revokedAt),
          or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, runtime.now())),
          or(isNull(inviteLinks.maxUses), lt(inviteLinks.useCount, inviteLinks.maxUses)),
        ),
      ),
  );
  const invited = new Map<string, Date>();
  for (const row of rows) {
    const email = row.sourceId.slice(row.sourceId.indexOf(":") + 1);
    const previous = invited.get(email);
    if (!previous || previous < row.createdAt) invited.set(email, row.createdAt);
  }
  return invited;
}

const invitedDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export async function buildMembersPreview(
  runtime: Runtime,
  community: Community,
  parsed: ParsedMembersCsv,
  actorUserId: string,
): Promise<MembersCsvPreview> {
  const existing = await lookup(runtime, community.id, [
    ...parsed.rows.map((row) => row.email),
    ...parsed.owners.map((row) => row.email),
  ]);
  const invites = await openInvites(runtime, community.id);
  const rows: MembersCsvPreviewRow[] = [
    ...parsed.errors.map((error) => ({
      line: error.line,
      email: error.email,
      name: null,
      role: null,
      status: "error" as const,
      message: error.message,
      values: error.values,
    })),
    ...parsed.leftOut.map((row) => ({
      line: row.line,
      email: row.email,
      name: row.name,
      role: null,
      status: "left_out" as const,
      message: row.message,
    })),
    ...parsed.owners.map((row) => {
      const base = { line: row.line, email: row.email, name: row.name, role: null };
      return existing.get(row.email)?.userId === actorUserId
        ? { ...base, status: "already_member" as const, message: "This is you." }
        : {
            ...base,
            status: "error" as const,
            message: "A community has one owner. Use member, moderator, or admin.",
          };
    }),
  ];
  const hideAccounts = runtime.fairUse.edition === "cloud";
  for (const row of parsed.rows) {
    const person = existing.get(row.email);
    const base = { line: row.line, email: row.email, name: row.name, role: row.role };
    const invitedAt = invites.get(row.email);
    if (person?.membershipStatus === "banned") {
      rows.push({ ...base, status: "error", message: "This person is banned from the community." });
    } else if (person?.membershipStatus === "active") {
      rows.push({ ...base, status: "already_member", message: null });
    } else if (invitedAt) {
      rows.push({
        ...base,
        status: "invited",
        message: `Invited on ${invitedDate.format(invitedAt)}.`,
      });
    } else if (hideAccounts) {
      rows.push({ ...base, status: "ready", message: null });
    } else {
      rows.push({ ...base, status: person ? "existing_account" : "new_account", message: null });
    }
  }
  rows.sort((a, b) => a.line - b.line);
  const count = (status: MembersCsvPreviewRow["status"]) =>
    rows.filter((row) => row.status === status).length;
  return {
    rows,
    totals: {
      rows: rows.length,
      ready: count("ready") + count("new_account") + count("existing_account"),
      newAccounts: hideAccounts ? null : count("new_account"),
      alreadyMembers: count("already_member"),
      invited: count("invited"),
      leftOut: count("left_out"),
      errors: count("error"),
    },
    notes: parsed.emailColumn ? [`Emails were read from the column ${parsed.emailColumn}.`] : [],
    memberLimit: (await memberLimits(runtime, community)).members,
    activeMembers: await activeMemberCount(runtime, community.id),
    addAllowed: runtime.fairUse.edition === "community",
  };
}

export interface ApplyMembersInput {
  readonly jobId: string;
  readonly community: Community;
  readonly actorId: string;
  readonly preview: MembersCsvPreview;
  readonly mode: MembersImportMode;
  readonly notify: boolean;
  readonly resend: boolean;
  readonly note: string | null;
}

const readyStatuses: ReadonlySet<MembersCsvPreviewRow["status"]> = new Set([
  "ready",
  "new_account",
  "existing_account",
]);

function readyRows(preview: MembersCsvPreview, resend: boolean): CsvMemberRow[] {
  return preview.rows.flatMap((row) =>
    (readyStatuses.has(row.status) || (resend && row.status === "invited")) && row.role
      ? [{ line: row.line, email: row.email, name: row.name, role: row.role }]
      : [],
  );
}

const notSentReason = "Not sent: the address opted out or bounced.";
const maxSkippedRows = 200;

const skippedReasons: Readonly<Record<MembersCsvPreviewRow["status"], string>> = {
  ready: "",
  new_account: "",
  existing_account: "",
  already_member: "Already a member.",
  invited: "Already invited.",
  left_out: "Left out.",
  error: "The row has an error.",
};

function skippedPreviewRows(preview: MembersCsvPreview, resend: boolean): MembersSkippedRow[] {
  return preview.rows.flatMap((row) =>
    (readyStatuses.has(row.status) || (resend && row.status === "invited")) && row.role
      ? []
      : [{ line: row.line, reason: row.message ?? skippedReasons[row.status] }],
  );
}

function displayName(row: CsvMemberRow): string {
  return row.name ?? row.email.slice(0, row.email.indexOf("@"));
}

async function send(
  runtime: Runtime,
  map: IdMap,
  communityId: string,
  key: string,
  message: EmailMessage,
): Promise<boolean> {
  if (!runtime.mailer || map.has("csv_email", key)) {
    return false;
  }
  await runtime.mailer.send(message);
  await inMigrationScope(runtime.db, communityId, async ({ tx }) => {
    await map.persist(tx, [map.assign("csv_email", key)]);
  });
  return true;
}

async function unconfirmedAccounts(
  runtime: Runtime,
  communityId: string,
  rows: readonly CsvMemberRow[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const found = await inMigrationScope(runtime.db, communityId, ({ tx }) =>
    tx
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          inArray(
            sql`lower(${users.email}::text)`,
            rows.map((row) => row.email),
          ),
          eq(users.emailVerified, false),
        ),
      ),
  );
  return new Set(found.map((row) => row.email.toLowerCase()));
}

async function invite(
  runtime: Runtime,
  map: IdMap,
  input: ApplyMembersInput,
  row: CsvMemberRow,
  entity: "csv_rows" | "csv_invites",
  inviterName: string,
): Promise<"sent" | "suppressed" | "none"> {
  const { community } = input;
  const key = `${row.line}:${row.email}`;
  if (map.has("csv_suppressed", key)) return "suppressed";
  if (
    !map.has("csv_email", key) &&
    (await runtime.suppression?.isSuppressed({
      addressHash: hashEmailAddress(row.email),
      communityId: community.id,
    }))
  ) {
    await inMigrationScope(runtime.db, community.id, async ({ tx }) => {
      await map.persist(tx, [map.assign("csv_suppressed", key)]);
    });
    return "suppressed";
  }
  let token: string | undefined;
  const inviteId = map.get(entity, key);
  if (!inviteId) {
    const id = newId();
    const created = randomBytes(32).toString("base64url");
    await inMigrationScope(runtime.db, community.id, async ({ tx }) => {
      await tx.insert(inviteLinks).values({
        id,
        communityId: community.id,
        token: created,
        createdBy: input.actorId,
        expiresAt: new Date(runtime.now().getTime() + inviteLifetimeDays * dayMs),
        maxUses: 1,
      });
      await map.persist(tx, [map.assign(entity, key, id)]);
    });
    token = created;
  } else if (!map.has("csv_email", key)) {
    const [link] = await inMigrationScope(runtime.db, community.id, ({ tx, where }) =>
      tx
        .select({ token: inviteLinks.token })
        .from(inviteLinks)
        .where(where(inviteLinks, eq(inviteLinks.id, inviteId))),
    );
    token = link?.token;
  }
  if (!token) return "none";
  const { firstContact, envelope } = firstContactMail(runtime, {
    to: row.email,
    communityId: community.id,
    inviterName,
    origin: { kind: "list" },
  });
  const sent = await send(runtime, map, community.id, key, {
    to: row.email,
    ...envelope,
    ...memberInvitedEmail({
      name: row.name ?? "",
      communityName: community.name,
      communityBrand: emailBrandOf(runtime, community),
      url: `${runtime.config.appUrl}/join/${token}`,
      move: { inviterName, origin: { kind: "list" } },
      note: input.note,
      ...(firstContact ? { firstContact } : {}),
    }),
  });
  return sent ? "sent" : "none";
}

export async function applyMembersImport(
  runtime: Runtime,
  input: ApplyMembersInput,
  onProgress: (done: number, total: number) => Promise<void>,
): Promise<MembersImportSummary> {
  const { community } = input;
  const map = await IdMap.load(runtime.db, community.id, input.jobId);
  const rows = readyRows(input.preview, input.resend);
  const limit = (await memberLimits(runtime, community)).members;
  const appUrl = runtime.config.appUrl;
  let added = 0;
  let invited = 0;
  let skipped = input.preview.totals.rows - rows.length;
  let emailsSent = 0;
  let limitReached = false;
  let done = 0;
  const skippedRows: MembersSkippedRow[] = skippedPreviewRows(input.preview, input.resend);
  const inviterName = (await userName(runtime, community.id, input.actorId)) ?? community.name;
  const count = (row: CsvMemberRow, delivery: Awaited<ReturnType<typeof invite>>) => {
    if (delivery === "sent") emailsSent += 1;
    if (delivery === "suppressed") skippedRows.push({ line: row.line, reason: notSentReason });
  };

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    if (input.mode === "invite") {
      for (const row of batch) {
        invited += 1;
        count(row, await invite(runtime, map, input, row, "csv_rows", inviterName));
      }
    } else {
      const open = batch.filter((row) => !map.has("csv_rows", `${row.line}:${row.email}`));
      const unconfirmed = await unconfirmedAccounts(runtime, community.id, open);
      for (const row of open.filter((candidate) => unconfirmed.has(candidate.email))) {
        invited += 1;
        count(row, await invite(runtime, map, input, row, "csv_invites", inviterName));
      }
      const active = await activeMemberCount(runtime, community.id);
      const pending = open.filter((row) => !unconfirmed.has(row.email));
      const room = limit === null ? pending.length : Math.max(0, limit - active);
      const accepted = pending.slice(0, room);
      if (accepted.length < pending.length) {
        limitReached = true;
        skipped += pending.length - accepted.length;
        for (const row of pending.slice(room)) {
          skippedRows.push({ line: row.line, reason: "The member limit was reached." });
        }
      }
      const withPassword = new Set<string>();
      await inMigrationScope(runtime.db, community.id, async ({ tx }) => {
        const emails = accepted.map((row) => row.email);
        const existing =
          emails.length === 0
            ? []
            : await tx
                .select({ id: users.id, email: users.email })
                .from(users)
                .where(inArray(sql`lower(${users.email}::text)`, emails));
        const byEmail = new Map(existing.map((row) => [row.email.toLowerCase(), row.id]));
        if (existing.length > 0) {
          const credentials = await tx
            .select({ userId: accounts.userId })
            .from(accounts)
            .where(
              and(
                inArray(
                  accounts.userId,
                  existing.map((row) => row.id),
                ),
                eq(accounts.providerId, "credential"),
              ),
            );
          for (const credential of credentials) withPassword.add(credential.userId);
        }
        const entries = [];
        for (const row of accepted) {
          let userId = byEmail.get(row.email);
          if (!userId) {
            userId = newId();
            await tx.insert(users).values({
              id: userId,
              email: row.email,
              name: displayName(row),
              emailVerified: false,
            });
          }
          const quiet = input.notify ? {} : { welcomeEmailSentAt: runtime.now() };
          const keepQuiet = input.notify
            ? {}
            : {
                welcomeEmailSentAt: sql`coalesce(${memberships.welcomeEmailSentAt}, ${runtime.now()})`,
              };
          await tx
            .insert(memberships)
            .values({
              communityId: community.id,
              userId,
              role: row.role,
              status: "active",
              joinedAt: runtime.now(),
              ...quiet,
            })
            .onConflictDoUpdate({
              target: [memberships.communityId, memberships.userId],
              set: { role: row.role, status: "active", joinedAt: runtime.now(), ...keepQuiet },
              setWhere: sql`${memberships.status} <> 'banned' and ${memberships.role} <> 'owner'`,
            });
          entries.push(map.assign("csv_rows", `${row.line}:${row.email}`, userId));
        }
        await map.persist(tx, entries);
      });
      added += accepted.length;
      if (input.notify) {
        for (const row of accepted) {
          const userId = map.get("csv_rows", `${row.line}:${row.email}`);
          const hasPassword = userId ? withPassword.has(userId) : false;
          const sent = await send(runtime, map, community.id, `${row.line}:${row.email}`, {
            to: row.email,
            communityId: community.id,
            ...memberAddedEmail({
              name: displayName(row),
              communityName: community.name,
              communityBrand: emailBrandOf(runtime, community),
              url: hasPassword
                ? `${appUrl}/c/${community.slug}`
                : userId
                  ? await passwordLink(runtime, community, userId)
                  : `${appUrl}/forgot-password`,
              hasPassword,
            }),
          });
          if (sent) emailsSent += 1;
        }
      }
    }
    done += batch.length;
    await onProgress(done, rows.length);
  }
  const notSent = skippedRows.filter((row) => row.reason === notSentReason).length;
  return {
    mode: input.mode,
    added,
    invited,
    skipped,
    emailsSent,
    notSent,
    limitReached,
    skippedRows: skippedRows.sort((a, b) => a.line - b.line).slice(0, maxSkippedRows),
  };
}
