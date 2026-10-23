import { appendAuditEntry, type ScopedQueries } from "@cohory/db";
import { memberships, paymentCustomers, subscriptionLinks, users } from "@cohory/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { LinkStore } from "./store";

export function createLinkStore({ tx, where, values, communityId }: ScopedQueries): LinkStore {
  async function first<T>(rows: Promise<T[]>): Promise<T | null> {
    return (await rows)[0] ?? null;
  }

  return {
    async matchUsersByEmail(emails) {
      if (emails.length === 0) {
        return [];
      }
      const rows = await tx
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          role: memberships.role,
          status: memberships.status,
        })
        .from(users)
        .leftJoin(
          memberships,
          and(eq(memberships.userId, users.id), eq(memberships.communityId, communityId)),
        )
        .where(and(inArray(users.email, [...emails]), isNull(users.erasedAt)));
      return rows.map((row) => ({
        userId: row.userId,
        email: row.email.toLowerCase(),
        name: row.name,
        emailVerified: row.emailVerified,
        membership: row.role && row.status ? { role: row.role, status: row.status } : null,
      }));
    },

    async bannedEmails(emails) {
      if (emails.length === 0) {
        return new Set();
      }
      const rows = await tx
        .select({ email: memberships.bannedEmail })
        .from(memberships)
        .where(
          where(
            memberships,
            eq(memberships.status, "banned"),
            inArray(memberships.bannedEmail, [...emails]),
          ),
        );
      return new Set(
        rows.map((row) => row.email?.toLowerCase()).filter((email) => email !== undefined),
      );
    },

    async customerOwners(connectionId, externalCustomerIds) {
      if (externalCustomerIds.length === 0) {
        return new Map();
      }
      const rows = await tx
        .select({
          externalCustomerId: paymentCustomers.externalCustomerId,
          userId: paymentCustomers.userId,
        })
        .from(paymentCustomers)
        .where(
          where(
            paymentCustomers,
            eq(paymentCustomers.connectionId, connectionId),
            inArray(paymentCustomers.externalCustomerId, [...externalCustomerIds]),
          ),
        );
      return new Map(rows.map((row) => [row.externalCustomerId, row.userId]));
    },

    findIdentity(userId) {
      return first(
        tx
          .select({ email: users.email, emailVerified: users.emailVerified })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.erasedAt)))
          .limit(1),
      );
    },

    async statuses(externalSubscriptionIds) {
      if (externalSubscriptionIds.length === 0) {
        return new Map();
      }
      const rows = await tx
        .select({ id: subscriptionLinks.externalSubscriptionId, status: subscriptionLinks.status })
        .from(subscriptionLinks)
        .where(
          where(
            subscriptionLinks,
            inArray(subscriptionLinks.externalSubscriptionId, [...externalSubscriptionIds]),
          ),
        );
      return new Map(rows.map((row) => [row.id, row.status]));
    },

    insert(link) {
      return first(
        tx
          .insert(subscriptionLinks)
          .values(values(link))
          .onConflictDoNothing({ target: subscriptionLinks.externalSubscriptionId })
          .returning(),
      );
    },

    listInvited(email) {
      return tx
        .select()
        .from(subscriptionLinks)
        .where(
          where(
            subscriptionLinks,
            eq(subscriptionLinks.status, "invited"),
            eq(subscriptionLinks.email, email),
          ),
        )
        .orderBy(asc(subscriptionLinks.createdAt))
        .limit(20);
    },

    async complete(linkId, completion) {
      const rows = await tx
        .update(subscriptionLinks)
        .set({
          status: "linked",
          userId: completion.userId,
          subscriptionId: completion.subscriptionId,
          linkedAt: completion.at,
          updatedAt: completion.at,
        })
        .where(
          where(
            subscriptionLinks,
            eq(subscriptionLinks.id, linkId),
            eq(subscriptionLinks.status, "invited"),
          ),
        )
        .returning({ id: subscriptionLinks.id });
      return rows.length > 0;
    },

    list(limit) {
      return tx
        .select()
        .from(subscriptionLinks)
        .where(where(subscriptionLinks))
        .orderBy(desc(subscriptionLinks.createdAt), desc(subscriptionLinks.id))
        .limit(limit);
    },

    async appendAudit(entry) {
      await appendAuditEntry({ tx, values }, entry);
    },
  };
}
