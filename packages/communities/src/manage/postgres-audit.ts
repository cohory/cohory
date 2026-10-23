import { appendOutbox, auditSourceColumns, newId, type ScopedQueries } from "@cohory/db";
import { agentIdentities, auditLog, users } from "@cohory/db/schema";
import { and, asc, desc, eq, gte, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { membershipEventsTopic } from "./events";
import type { ManageStore } from "./repository";

export function createAuditStore(
  queries: ScopedQueries,
): Pick<ManageStore, "listAudit" | "listAuditActions" | "appendMembershipEvents" | "appendAudit"> {
  const { tx, where, values, communityId } = queries;

  return {
    listAudit(filter) {
      const actorUser = alias(users, "actor_user");
      const targetUser = alias(users, "target_user");
      return tx
        .select({
          id: auditLog.id,
          createdAt: auditLog.createdAt,
          actorId: auditLog.actorId,
          actorName: actorUser.name,
          actorType: auditLog.actorType,
          via: auditLog.via,
          tokenId: auditLog.tokenId,
          agentId: auditLog.agentId,
          agentName: agentIdentities.name,
          action: auditLog.action,
          target: auditLog.target,
          targetName: targetUser.name,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
        .leftJoin(targetUser, sql`${targetUser.id}::text = ${auditLog.target}`)
        .leftJoin(agentIdentities, eq(agentIdentities.id, auditLog.agentId))
        .where(
          where(
            auditLog,
            filter.action ? eq(auditLog.action, filter.action) : undefined,
            filter.actorType ? eq(auditLog.actorType, filter.actorType) : undefined,
            filter.via ? eq(auditLog.via, filter.via) : undefined,
            filter.agentId ? eq(auditLog.agentId, filter.agentId) : undefined,
            filter.tokenId ? eq(auditLog.tokenId, filter.tokenId) : undefined,
            filter.excludeActions.length > 0
              ? notInArray(auditLog.action, [...filter.excludeActions])
              : undefined,
            filter.credentialActorId
              ? and(eq(auditLog.actorId, filter.credentialActorId), isNotNull(auditLog.tokenId))
              : undefined,
            filter.from ? gte(auditLog.createdAt, filter.from) : undefined,
            filter.before ? lt(auditLog.createdAt, filter.before) : undefined,
            filter.cursor
              ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${filter.cursor.createdAt.toISOString()}::timestamptz, ${filter.cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(filter.limit);
    },

    async listAuditActions() {
      const rows = await tx
        .selectDistinct({ action: auditLog.action })
        .from(auditLog)
        .where(where(auditLog))
        .orderBy(asc(auditLog.action));
      return rows.map((row) => row.action);
    },

    async appendMembershipEvents(events) {
      if (events.length === 0) {
        return;
      }
      await appendOutbox(tx, {
        id: newId(),
        communityId,
        topic: membershipEventsTopic,
        payload: { events },
      });
    },

    async appendAudit(entry) {
      await tx.insert(auditLog).values(
        values({
          actorId: entry.actorId,
          ...auditSourceColumns(entry.actorId),
          action: entry.action,
          target: entry.target,
          metadata: entry.metadata ?? null,
        }),
      );
    },
  };
}
