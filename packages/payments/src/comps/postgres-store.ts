import { appendAuditEntry, setRlsFlag, type Database, type ScopedQueries } from "@cohory/db";
import { compedMemberships, compInvitations, users } from "@cohory/db/schema";
import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { CompInvitationStore, CompStore, DueComp } from "./store";

async function first<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

function createInvitationStore({ tx, where, values }: ScopedQueries): CompInvitationStore {
  const open = () => [isNull(compInvitations.acceptedAt), isNull(compInvitations.withdrawnAt)];
  return {
    insert(invitation) {
      return first(
        tx.insert(compInvitations).values(values(invitation)).onConflictDoNothing().returning(),
      );
    },

    findOpenByEmail(email) {
      return first(
        tx
          .select()
          .from(compInvitations)
          .where(
            where(compInvitations, sql`${compInvitations.email} = ${email}::citext`, ...open()),
          )
          .limit(1),
      );
    },

    findOpen(invitationId) {
      return first(
        tx
          .select()
          .from(compInvitations)
          .where(where(compInvitations, eq(compInvitations.id, invitationId), ...open()))
          .limit(1),
      );
    },

    listOpen(limit) {
      const granter = alias(users, "granter");
      return tx
        .select({ invitation: compInvitations, grantedByName: granter.name })
        .from(compInvitations)
        .leftJoin(granter, eq(granter.id, compInvitations.grantedBy))
        .where(where(compInvitations, ...open()))
        .orderBy(desc(compInvitations.createdAt), desc(compInvitations.id))
        .limit(limit);
    },

    withdraw(invitationId, withdrawal) {
      return first(
        tx
          .update(compInvitations)
          .set({ withdrawnAt: withdrawal.at, withdrawnBy: withdrawal.by, updatedAt: withdrawal.at })
          .where(where(compInvitations, eq(compInvitations.id, invitationId), ...open()))
          .returning(),
      );
    },

    accept(invitationId, acceptance) {
      return first(
        tx
          .update(compInvitations)
          .set({
            acceptedAt: acceptance.at,
            acceptedBy: acceptance.userId,
            compId: acceptance.compId,
            updatedAt: acceptance.at,
          })
          .where(where(compInvitations, eq(compInvitations.id, invitationId), ...open()))
          .returning(),
      );
    },
  };
}

export function createCompStore(queries: ScopedQueries): CompStore {
  const { tx, where, values } = queries;
  return {
    invitations: createInvitationStore(queries),
    findOpen(userId) {
      return first(
        tx
          .select()
          .from(compedMemberships)
          .where(
            where(
              compedMemberships,
              eq(compedMemberships.userId, userId),
              isNull(compedMemberships.endedAt),
            ),
          )
          .limit(1),
      );
    },

    find(compId) {
      return first(
        tx
          .select()
          .from(compedMemberships)
          .where(where(compedMemberships, eq(compedMemberships.id, compId)))
          .limit(1),
      );
    },

    insert(comp) {
      return first(
        tx.insert(compedMemberships).values(values(comp)).onConflictDoNothing().returning(),
      );
    },

    setExpiry(compId, expiresAt, at) {
      return first(
        tx
          .update(compedMemberships)
          .set({ expiresAt, updatedAt: at })
          .where(
            where(
              compedMemberships,
              eq(compedMemberships.id, compId),
              isNull(compedMemberships.endedAt),
            ),
          )
          .returning(),
      );
    },

    end(compId, end) {
      return first(
        tx
          .update(compedMemberships)
          .set({ endedAt: end.at, endReason: end.reason, endedBy: end.endedBy, updatedAt: end.at })
          .where(
            where(
              compedMemberships,
              eq(compedMemberships.id, compId),
              isNull(compedMemberships.endedAt),
            ),
          )
          .returning(),
      );
    },

    listOpen(limit) {
      const granter = alias(users, "granter");
      return tx
        .select({
          comp: compedMemberships,
          userName: users.name,
          userEmail: users.email,
          grantedByName: granter.name,
        })
        .from(compedMemberships)
        .innerJoin(users, eq(users.id, compedMemberships.userId))
        .leftJoin(granter, eq(granter.id, compedMemberships.grantedBy))
        .where(where(compedMemberships, isNull(compedMemberships.endedAt)))
        .orderBy(desc(compedMemberships.createdAt), desc(compedMemberships.id))
        .limit(limit);
    },

    async findUserIdByEmail(email) {
      const row = await first(
        tx
          .select({ id: users.id })
          .from(users)
          .where(and(sql`${users.email} = ${email}::citext`, isNull(users.erasedAt)))
          .limit(1),
      );
      return row?.id ?? null;
    },

    async appendAudit(entry) {
      await appendAuditEntry({ tx, values }, entry);
    },
  };
}

export async function listDueComps(db: Database, now: Date, limit: number): Promise<DueComp[]> {
  return db.transaction(async (tx) => {
    await setRlsFlag(tx, "payments_webhook");
    return tx
      .select({
        id: compedMemberships.id,
        communityId: compedMemberships.communityId,
        userId: compedMemberships.userId,
      })
      .from(compedMemberships)
      .where(
        and(
          isNull(compedMemberships.endedAt),
          isNotNull(compedMemberships.expiresAt),
          lte(compedMemberships.expiresAt, now),
        ),
      )
      .orderBy(asc(compedMemberships.expiresAt))
      .limit(limit);
  });
}
