import {
  findConnectionClosedAtIn,
  isUniqueViolation,
  markTestCheckoutSucceeded,
  setCommunityCurrency,
  setRlsFlag,
  type ScopedQueries,
} from "@cohory/db";
import { creatorTermsAcceptances, membershipPlans, paymentConnections } from "@cohory/db/schema";
import { desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

import { PlanConflictError } from "../errors";
import type { PaymentsStore } from "../repository";
import { first, required } from "./rows";

export function createPlanStore(
  queries: ScopedQueries,
): Pick<
  PaymentsStore,
  | "enableManagement"
  | "acceptCreatorTerms"
  | "hasAcceptedCreatorTerms"
  | "findOpenConnection"
  | "findConnectionClosedAt"
  | "insertConnection"
  | "updateConnection"
  | "findActivePlan"
  | "findDraftPlan"
  | "findPlan"
  | "findPlanByPrice"
  | "insertPlan"
  | "updatePlan"
  | "updateDraftPlan"
  | "markTestCheckoutSucceeded"
  | "setCommunityCurrency"
> {
  const { tx, where, values } = queries;

  return {
    enableManagement() {
      return setRlsFlag(tx, "payments_manager");
    },

    async acceptCreatorTerms(userId, version) {
      await tx
        .insert(creatorTermsAcceptances)
        .values(values({ userId, version }))
        .onConflictDoNothing();
    },

    async hasAcceptedCreatorTerms(userId, version) {
      const row = await first(
        tx
          .select({ version: creatorTermsAcceptances.version })
          .from(creatorTermsAcceptances)
          .where(
            where(
              creatorTermsAcceptances,
              eq(creatorTermsAcceptances.userId, userId),
              eq(creatorTermsAcceptances.version, version),
            ),
          )
          .limit(1),
      );
      return row !== null;
    },

    findOpenConnection() {
      return first(
        tx
          .select()
          .from(paymentConnections)
          .where(where(paymentConnections, ne(paymentConnections.status, "disconnected")))
          .limit(1),
      );
    },

    findConnectionClosedAt(connectionId) {
      return findConnectionClosedAtIn(queries, connectionId);
    },

    insertConnection(input) {
      return required(tx.insert(paymentConnections).values(values(input)).returning());
    },

    updateConnection(connectionId, patch) {
      return required(
        tx
          .update(paymentConnections)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(paymentConnections, eq(paymentConnections.id, connectionId)))
          .returning(),
      );
    },

    findActivePlan() {
      return first(
        tx
          .select()
          .from(membershipPlans)
          .where(
            where(
              membershipPlans,
              isNull(membershipPlans.archivedAt),
              isNotNull(membershipPlans.connectionId),
            ),
          )
          .limit(1),
      );
    },

    findDraftPlan() {
      return first(
        tx
          .select()
          .from(membershipPlans)
          .where(
            where(
              membershipPlans,
              isNull(membershipPlans.archivedAt),
              isNull(membershipPlans.connectionId),
            ),
          )
          .limit(1),
      );
    },

    findPlan(planId) {
      return first(
        tx
          .select()
          .from(membershipPlans)
          .where(where(membershipPlans, eq(membershipPlans.id, planId)))
          .limit(1),
      );
    },

    findPlanByPrice(providerPriceId) {
      return first(
        tx
          .select()
          .from(membershipPlans)
          .where(
            where(
              membershipPlans,
              or(
                eq(membershipPlans.providerMonthlyPriceId, providerPriceId),
                eq(membershipPlans.providerAnnualPriceId, providerPriceId),
              ),
            ),
          )
          .orderBy(desc(membershipPlans.createdAt))
          .limit(1),
      );
    },

    async insertPlan(input) {
      try {
        return await required(tx.insert(membershipPlans).values(values(input)).returning());
      } catch (error: unknown) {
        if (isUniqueViolation(error, "membership_plans_one_active_per_community")) {
          throw new PlanConflictError();
        }
        throw error;
      }
    },

    updatePlan(planId, patch) {
      return required(
        tx
          .update(membershipPlans)
          .set({ ...patch, updatedAt: new Date() })
          .where(where(membershipPlans, eq(membershipPlans.id, planId)))
          .returning(),
      );
    },

    updateDraftPlan(planId, prices) {
      return required(
        tx
          .update(membershipPlans)
          .set({ ...prices, updatedAt: new Date() })
          .where(
            where(
              membershipPlans,
              eq(membershipPlans.id, planId),
              isNull(membershipPlans.connectionId),
            ),
          )
          .returning(),
      );
    },

    markTestCheckoutSucceeded(at) {
      return markTestCheckoutSucceeded(queries, at);
    },

    setCommunityCurrency(currency) {
      return setCommunityCurrency(queries, currency);
    },
  };
}
