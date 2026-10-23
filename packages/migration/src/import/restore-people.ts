import { randomBytes } from "node:crypto";

import { newId } from "@cohory/db";
import { inviteLinks, membershipRequests, memberships, users } from "@cohory/db/schema";
import { inArray, sql } from "drizzle-orm";

import { findAccounts, matchAccount, placeholderEmail } from "./accounts";
import { placeholderEmailKey, type MappedId } from "./id-map";
import { chunks, date, dateOrNull, restoreBatchSize, type RestoreContext } from "./restore-context";
import type { ImportSummary } from "./summary";

export async function restoreUsers(ctx: RestoreContext): Promise<ImportSummary["users"]> {
  const { deps, input, records, map, skips, scope, progress } = ctx;
  for (const batch of chunks(records.users, restoreBatchSize)) {
    const pending = batch.filter((row) => !map.has("users", row.id));
    if (pending.length > 0) {
      const entries: MappedId[] = [];
      await scope(async (tx) => {
        const live = pending.filter((row) => !row.erased);
        const accounts = await findAccounts(
          tx,
          live.map((row) => row.email),
        );
        const rule = { edition: deps.edition, ownerUserId: input.ownerUserId };
        const wantedNames = live
          .filter((row) => row.username && !accounts.has(row.email.toLowerCase()))
          .map((row) => (row.username ?? "").toLowerCase());
        const takenNames =
          wantedNames.length === 0
            ? new Set<string>()
            : new Set(
                (
                  await tx
                    .select({ username: users.username })
                    .from(users)
                    .where(inArray(sql`lower(${users.username}::text)`, wantedNames))
                ).map((row) => (row.username ?? "").toLowerCase()),
              );
        for (const row of pending) {
          const match = row.erased
            ? ({ kind: "none" } as const)
            : matchAccount(accounts.get(row.email.toLowerCase()), rule);
          if (match.kind === "link") {
            entries.push({ entity: "users", sourceId: row.id, targetId: match.userId });
            continue;
          }
          const id = newId();
          if (match.kind === "placeholder") {
            await tx.insert(users).values({
              id,
              name: row.name,
              email: placeholderEmail(id),
              emailVerified: false,
            });
            entries.push({ entity: "users", sourceId: row.id, targetId: id });
            entries.push({ entity: "users_placeholder", sourceId: row.id, targetId: id });
            entries.push({
              entity: "placeholder_email",
              sourceId: placeholderEmailKey(row.id, row.email),
              targetId: id,
            });
            continue;
          }
          const username =
            row.username && !takenNames.has(row.username.toLowerCase()) ? row.username : null;
          if (row.username && !username) {
            skips.add("users.username", row.id, "The username is taken on this instance.");
          }
          if (username) takenNames.add(username.toLowerCase());
          await tx.insert(users).values(
            row.erased
              ? {
                  id,
                  name: row.name,
                  email: `erased-${id}@erased.invalid`,
                  emailVerified: false,
                  erasedAt: deps.now(),
                }
              : { id, name: row.name, email: row.email, username, emailVerified: false },
          );
          entries.push({ entity: "users", sourceId: row.id, targetId: id });
          if (!row.erased) {
            entries.push({ entity: "users_created", sourceId: row.id, targetId: id });
          }
        }
        await map.persist(tx, entries);
      });
      for (const entry of entries) map.remember(entry);
    }
    await progress("users", batch.length);
  }
  let created = 0;
  let linked = 0;
  let invited = 0;
  for (const row of records.users) {
    if (map.has("users_created", row.id)) created += 1;
    else if (map.has("users_placeholder", row.id)) invited += 1;
    else if (!row.erased && map.has("users", row.id)) linked += 1;
  }
  return { created, linked, invited };
}

export async function restoreMemberships(
  ctx: RestoreContext,
): Promise<ImportSummary["ownerImportedAs"]> {
  const { deps, input, records, target, map, skips, phase, user } = ctx;
  let ownerImportedAs: ImportSummary["ownerImportedAs"] = "none";
  const archiveOwner = records.memberships.find((row) => row.role === "owner");
  if (archiveOwner) {
    ownerImportedAs = user(archiveOwner.userId) === input.ownerUserId ? "owner" : "admin";
  }

  // A placeholder is never a member: its membership only keeps history, so it must not count
  // against the member limit, show in member lists, or grant access. The id map remembers who
  // was active at the source, which decides who gets an invitation.
  const invitedMembers: MappedId[] = [];
  await phase(
    "memberships",
    records.memberships,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const userId = user(row.userId);
        if (!userId) {
          skips.add("memberships", row.id, "The person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        if (userId === input.ownerUserId) {
          continue;
        }
        const placeholder = map.has("users_placeholder", row.userId);
        if (placeholder && row.status === "active") {
          invitedMembers.push(map.assign("placeholder_member", row.userId, userId));
        }
        values.push({
          id,
          communityId: target,
          userId,
          role: row.role === "owner" ? ("admin" as const) : row.role,
          status: placeholder && row.status !== "banned" ? ("removed" as const) : row.status,
          bio: row.bio,
          joinAnswers: row.joinAnswers,
          bannedEmail: row.status === "banned" ? row.bannedEmail : null,
          joinedAt: dateOrNull(row.joinedAt),
          lastSeenAt: dateOrNull(row.lastSeenAt),
          createdAt: date(row.createdAt),
          welcomeEmailSentAt: input.membersEmailed === false ? deps.now() : null,
        });
      }
      if (values.length > 0) {
        await tx.insert(memberships).values(values).onConflictDoNothing();
      }
      await map.persist(tx, invitedMembers.splice(0));
      return skipped;
    },
  );
  return ownerImportedAs;
}

/** Returns how many links got a new token because theirs was taken on this instance. */
export async function restoreInviteLinks(ctx: RestoreContext): Promise<number> {
  const { input, records, target, phase, user } = ctx;
  let renamedInviteLinks = 0;
  await phase(
    "invite_links",
    records.invite_links,
    (row) => row.id,
    async (tx, items) => {
      for (const { row, id } of items) {
        const fields = {
          id,
          communityId: target,
          createdBy: user(row.createdBy) ?? input.ownerUserId,
          expiresAt: dateOrNull(row.expiresAt),
          maxUses: row.maxUses,
          useCount: row.maxUses === null ? row.useCount : Math.min(row.useCount, row.maxUses),
          requiresApproval: row.requiresApproval,
          revokedAt: dateOrNull(row.revokedAt),
          createdAt: date(row.createdAt),
        };
        const inserted = await tx
          .insert(inviteLinks)
          .values({ ...fields, token: row.token })
          .onConflictDoNothing()
          .returning({ id: inviteLinks.id });
        if (inserted.length === 0) {
          await tx
            .insert(inviteLinks)
            .values({ ...fields, token: randomBytes(32).toString("base64url") });
          renamedInviteLinks += 1;
        }
      }
      return new Set<string>();
    },
  );
  return renamedInviteLinks;
}

export async function restoreMembershipRequests(ctx: RestoreContext): Promise<void> {
  const { records, target, skips, phase, user } = ctx;
  await phase(
    "membership_requests",
    records.membership_requests,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const userId = user(row.userId);
        if (!userId) {
          skips.add("membership_requests", row.id, "The person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        await tx
          .insert(membershipRequests)
          .values({
            id,
            communityId: target,
            userId,
            status: row.status,
            answers: row.answers,
            decisionNote: row.decisionNote,
            decidedBy: user(row.decidedBy) ?? null,
            decidedAt: dateOrNull(row.decidedAt),
            createdAt: date(row.createdAt),
          })
          .onConflictDoNothing();
      }
      return skipped;
    },
  );
}
