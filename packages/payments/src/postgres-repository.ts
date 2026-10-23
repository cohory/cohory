import {
  communityIdSchema,
  getCommunityById,
  restoreLeftMembership,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
  type ScopedQueries,
} from "@cohory/db";
import { communityImageUrl } from "@cohory/email";
import { communities, paymentConnections, subscriptions } from "@cohory/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { createLedgerStore } from "./postgres/ledger";
import { activateMemberIn, createMemberStore, removeMemberIn } from "./postgres/members";
import { createPlanStore } from "./postgres/plans";
import { first } from "./postgres/rows";
import { createSubscriptionStore } from "./postgres/subscriptions";
import { asWebhook, createEventRepository } from "./postgres/events";

import { createCompStore, listDueComps } from "./comps/postgres-store";
import { createHoldStore, listDueHolds } from "./holds/postgres-store";
import { createMoveStore } from "./moves/postgres-store";
import { createErasureStore } from "./erasure/postgres-store";
import { createExitStore } from "./exit/postgres-store";
import { createLinkStore } from "./linking/postgres-store";
import { createMetricsStore } from "./metrics/postgres-store";
import { createTenureStore } from "./tenure/postgres-store";
import { createAccessSummaryStore } from "./access-summary/postgres-store";
import {
  reconcilableStatuses,
  type ConnectionRecord,
  type PaymentsRepository,
  type PaymentsStore,
} from "./repository";

function createStore(queries: ScopedQueries): PaymentsStore {
  return {
    communityId: queries.communityId,
    accessSummary: createAccessSummaryStore(queries),
    comps: createCompStore(queries),
    holds: createHoldStore(queries),
    erasure: createErasureStore(queries),
    exit: createExitStore(queries),
    links: createLinkStore(queries),
    moves: createMoveStore(queries),
    tenure: createTenureStore(queries),
    metrics: createMetricsStore(queries),
    ...createMemberStore(queries),
    ...createPlanStore(queries),
    ...createSubscriptionStore(queries),
    ...createLedgerStore(queries),
  };
}

export function createPostgresPaymentsRepository(db: Database): PaymentsRepository {
  return {
    async findCommunity(communityId) {
      const community = await getCommunityById(db, communityId);
      return community
        ? {
            id: community.id,
            slug: community.slug,
            name: community.name,
            privacy: community.privacy,
            archived: community.archivedAt !== null || community.deletedAt !== null,
            joinMode: community.joinMode,
            joinQuestions: community.joinQuestions ?? [],
            imageUrl: communityImageUrl(community.appearance),
          }
        : null;
    },

    inCommunity(communityId, userId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        if (userId) {
          await setRlsValue(queries.tx, "user_id", userId);
        }
        return fn(createStore(queries));
      });
    },

    inCommunityAsSystem(communityId, fn) {
      return runInCommunity(withCommunity(db, communityId), async (queries) => {
        await setRlsFlag(queries.tx, "payments_manager");
        await setRlsFlag(queries.tx, "payments_webhook");
        return fn(createStore(queries));
      });
    },

    ...createEventRepository(db),

    findConnectionByAccount(externalAccountId): Promise<ConnectionRecord | null> {
      return asWebhook(db, (tx) =>
        first(
          tx
            .select()
            .from(paymentConnections)
            .where(
              and(
                eq(paymentConnections.externalAccountId, externalAccountId),
                ne(paymentConnections.status, "disconnected"),
              ),
            )
            .limit(1),
        ),
      );
    },

    findExitedConnectionByAccount(externalAccountId): Promise<ConnectionRecord | null> {
      return asWebhook(db, (tx) =>
        first(
          tx
            .select()
            .from(paymentConnections)
            .where(
              and(
                eq(paymentConnections.externalAccountId, externalAccountId),
                eq(paymentConnections.provider, "stripe_connect"),
                eq(paymentConnections.status, "disconnected"),
              ),
            )
            .orderBy(desc(paymentConnections.disconnectedAt), desc(paymentConnections.id))
            .limit(1),
        ),
      );
    },

    listReconcilableConnectionIds(afterId, limit) {
      return asWebhook(db, async (tx) => {
        const rows = await tx
          .select({ id: paymentConnections.id })
          .from(paymentConnections)
          .where(
            and(
              afterId ? gt(paymentConnections.id, afterId) : undefined,
              inArray(paymentConnections.status, reconcilableStatuses),
            ),
          )
          .orderBy(paymentConnections.id)
          .limit(limit);
        return rows.map((row) => row.id);
      });
    },

    listSealedConnections(afterId, limit) {
      return asWebhook(db, async (tx) => {
        const rows = await tx
          .select({
            id: paymentConnections.id,
            communityId: paymentConnections.communityId,
            encryptedSecret: paymentConnections.encryptedSecret,
            webhookSecretEncrypted: paymentConnections.webhookSecretEncrypted,
          })
          .from(paymentConnections)
          .where(
            and(
              afterId ? gt(paymentConnections.id, afterId) : undefined,
              or(
                sql`${paymentConnections.encryptedSecret} is not null`,
                sql`${paymentConnections.webhookSecretEncrypted} is not null`,
              ),
            ),
          )
          .orderBy(paymentConnections.id)
          .limit(limit);
        return rows.map((row) => ({
          ...row,
          communityId: communityIdSchema.parse(row.communityId),
        }));
      });
    },

    replaceSealedSecrets(connection, next) {
      return runInCommunity(withCommunity(db, connection.communityId), async ({ tx, where }) => {
        await setRlsFlag(tx, "payments_manager");
        const same = (column: AnyPgColumn, value: string | null) =>
          value === null ? isNull(column) : eq(column, value);
        const updated = await tx
          .update(paymentConnections)
          .set({
            encryptedSecret: next.encryptedSecret,
            webhookSecretEncrypted: next.webhookSecretEncrypted,
          })
          .where(
            where(
              paymentConnections,
              and(
                eq(paymentConnections.id, connection.id),
                same(paymentConnections.encryptedSecret, connection.encryptedSecret),
                same(paymentConnections.webhookSecretEncrypted, connection.webhookSecretEncrypted),
              ),
            ),
          )
          .returning({ id: paymentConnections.id });
        return updated.length === 1;
      });
    },

    findConnectionById(connectionId) {
      return asWebhook(db, (tx) =>
        first(
          tx
            .select()
            .from(paymentConnections)
            .where(eq(paymentConnections.id, connectionId))
            .limit(1),
        ),
      );
    },

    activateMembership(communityId, userId, at) {
      const scope = withCommunity(db, communityIdSchema.parse(communityId));
      return runInCommunity(scope, async (queries) => {
        await activateMemberIn(queries, userId, at);
      });
    },

    listDueComps(now, limit) {
      return listDueComps(db, now, limit);
    },

    // The policy on subscriber_moves needs one community at a time, so a batch of
    // communities shares one transaction and switches the scope per community.
    removeExpiredMoves(communityIds, cutoffs) {
      return db.transaction(async (tx) => {
        await setRlsFlag(tx, "payments_webhook");
        let removed = 0;
        for (const id of communityIds) {
          const communityId = communityIdSchema.parse(id);
          await setRlsValue(tx, "community_id", communityId);
          removed += await createMoveStore({
            communityId,
            tx,
            where: (table, ...conditions) =>
              and(eq(table.communityId, communityId), ...conditions) ?? sql`false`,
            values: (input) => ({ ...input, communityId }),
          }).removeExpired(cutoffs);
        }
        return removed;
      });
    },

    async listCommunityIds(after, limit) {
      const rows = await db
        .select({ id: communities.id })
        .from(communities)
        .where(after ? gt(communities.id, after) : undefined)
        .orderBy(asc(communities.id))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    listDueHolds(now, limit) {
      return listDueHolds(db, now, limit);
    },

    listYearlyRenewals(from, to, limit) {
      return asWebhook(db, async (tx) => {
        const rows = await tx
          .select({
            communityId: subscriptions.communityId,
            subscriptionId: subscriptions.id,
            renewsAt: subscriptions.currentPeriodEnd,
          })
          .from(subscriptions)
          .innerJoin(paymentConnections, eq(paymentConnections.id, subscriptions.connectionId))
          .where(
            and(
              isNull(paymentConnections.disconnectedAt),
              eq(subscriptions.interval, "year"),
              eq(subscriptions.providerStatus, "active"),
              eq(subscriptions.accessState, "granted"),
              eq(subscriptions.cancelAtPeriodEnd, false),
              gte(subscriptions.currentPeriodEnd, from),
              lt(subscriptions.currentPeriodEnd, to),
            ),
          )
          .orderBy(subscriptions.currentPeriodEnd, subscriptions.id)
          .limit(limit);
        return rows.flatMap((row) =>
          row.renewsAt
            ? [
                {
                  ...row,
                  communityId: communityIdSchema.parse(row.communityId),
                  renewsAt: row.renewsAt,
                },
              ]
            : [],
        );
      });
    },

    listClosedBillingDue(now, limit) {
      return asWebhook(db, async (tx) => {
        const accessEnd = sql<Date>`greatest(coalesce(${subscriptions.currentPeriodEnd}, ${paymentConnections.disconnectedAt}), ${paymentConnections.disconnectedAt})`;
        const rows = await tx
          .select({
            communityId: subscriptions.communityId,
            subscriptionId: subscriptions.id,
            userId: subscriptions.userId,
            closedAt: paymentConnections.disconnectedAt,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            accessState: subscriptions.accessState,
          })
          .from(subscriptions)
          .innerJoin(paymentConnections, eq(paymentConnections.id, subscriptions.connectionId))
          .where(
            and(
              eq(paymentConnections.status, "disconnected"),
              isNotNull(paymentConnections.disconnectedAt),
              inArray(subscriptions.accessState, ["granted", "grace"]),
              lte(accessEnd, now),
            ),
          )
          .orderBy(accessEnd, subscriptions.id)
          .limit(limit);
        return rows.flatMap((row) =>
          row.closedAt
            ? [
                {
                  ...row,
                  communityId: communityIdSchema.parse(row.communityId),
                  closedAt: row.closedAt,
                },
              ]
            : [],
        );
      });
    },

    async restoreLeftMembership(communityId, userId, at) {
      const scope = withCommunity(db, communityIdSchema.parse(communityId));
      return (await restoreLeftMembership(scope, userId, at)) !== null;
    },

    removeMembership(communityId, userId) {
      const scope = withCommunity(db, communityIdSchema.parse(communityId));
      return runInCommunity(scope, (queries) => removeMemberIn(queries, userId));
    },
  };
}
