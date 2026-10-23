import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";

import {
  CommunityArchivedCheckoutError,
  CurrencyLockedError,
  NotConnectedError,
  PaymentAccountReviewRequiredError,
  PaymentsNotFoundError,
  PaymentsValidationError,
} from "../errors";
import { planPriceIssues } from "../currency";
import type { ConnectionRecord, PlanRecord } from "../repository";
import { upsertPlanInputSchema, type UpsertPlanInput } from "../schemas";
import { awaitsOwnerReview, toDraftPlanView, toPlanView, type PlanView } from "../views";
import { callStripe, loadCommunity, parse, providerFor, withAccess, type Runtime } from "./context";

export interface PlanOperations {
  getPlan(actor: Actor, communityId: string): Promise<PlanView | null>;
  getDraftPlan(actor: Actor, communityId: string): Promise<PlanView | null>;
  upsertPlan(actor: Actor, communityId: string, input: UpsertPlanInput): Promise<PlanView>;
  archivePlan(actor: Actor, communityId: string): Promise<void>;
}

function samePrices(
  plan: PlanRecord,
  input: { currency: string; monthlyPriceMinor: number; annualPriceMinor: number | null },
): boolean {
  return (
    plan.currency === input.currency &&
    plan.monthlyPriceMinor === input.monthlyPriceMinor &&
    plan.annualPriceMinor === input.annualPriceMinor
  );
}

function canSell(connection: ConnectionRecord | null): connection is ConnectionRecord {
  return (
    connection !== null &&
    connection.externalAccountId !== null &&
    connection.status === "active" &&
    connection.chargesEnabled
  );
}

function needsProvisioning(plan: PlanRecord): boolean {
  return (
    plan.providerProductId === null ||
    plan.providerMonthlyPriceId === null ||
    (plan.annualPriceMinor !== null && plan.providerAnnualPriceId === null)
  );
}

export function createPlanOperations(runtime: Runtime): PlanOperations {
  async function provision(plan: PlanRecord, connection: ConnectionRecord): Promise<PlanRecord> {
    if (!needsProvisioning(plan)) {
      return plan;
    }
    const { provider, conn } = providerFor(runtime, connection);
    const community = await runtime.repo.findCommunity(communityIdSchema.parse(plan.communityId));
    const provisioned = await callStripe(runtime, () =>
      provider.provisionPlan(
        {
          planId: plan.id,
          communityId: plan.communityId,
          name: plan.name,
          imageUrl: community?.imageUrl ?? null,
          currency: plan.currency,
          monthlyPriceMinor: plan.monthlyPriceMinor,
          annualPriceMinor: plan.annualPriceMinor,
          productId: plan.providerProductId,
          monthlyPriceId: plan.providerMonthlyPriceId,
          annualPriceId: plan.providerAnnualPriceId,
        },
        conn,
      ),
    );
    return runtime.repo.inCommunityAsSystem(communityIdSchema.parse(plan.communityId), (store) =>
      store.updatePlan(plan.id, {
        providerProductId: provisioned.productId,
        providerMonthlyPriceId: provisioned.monthlyPriceId,
        providerAnnualPriceId: provisioned.annualPriceId,
      }),
    );
  }

  async function rename(
    plan: PlanRecord,
    connection: ConnectionRecord,
    name: string,
  ): Promise<PlanRecord> {
    const { provider, conn } = providerFor(runtime, connection);
    const productId = plan.providerProductId;
    const renameProduct = provider.renameProduct?.bind(provider);
    if (productId && renameProduct) {
      await callStripe(runtime, () =>
        renameProduct(productId, name, `plan:${plan.id}:rename:${runtime.newId()}`, conn),
      );
    }
    return runtime.repo.inCommunityAsSystem(communityIdSchema.parse(plan.communityId), (store) =>
      store.updatePlan(plan.id, { name }),
    );
  }

  async function deactivatePrices(
    plan: PlanRecord,
    connection: ConnectionRecord | null,
  ): Promise<void> {
    if (!connection || connection.id !== plan.connectionId) {
      return;
    }
    const { provider, conn } = providerFor(runtime, connection);
    for (const priceId of [plan.providerMonthlyPriceId, plan.providerAnnualPriceId]) {
      if (priceId) {
        await callStripe(runtime, () =>
          provider.retirePrice(priceId, `plan:${plan.id}:deactivate:${priceId}`, conn),
        );
      }
    }
  }

  return {
    async getPlan(actor, communityId) {
      const community = await loadCommunity(runtime, communityId);
      return runtime.repo.inCommunity(
        community.id,
        actor.kind === "user" ? actor.userId : null,
        async (store) => {
          const plan = await store.findActivePlan();
          if (!plan) {
            return null;
          }
          const view = toPlanView(
            plan,
            await store.findOpenConnection(),
            await store.findOwnerId(),
          );
          return community.archived ? { ...view, purchasable: false } : view;
        },
      );
    },

    async getDraftPlan(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "edit_plan", "payment", context);
        await store.enableManagement();
        const draft = await store.findDraftPlan();
        return draft ? toDraftPlanView(draft) : null;
      });
    },

    async upsertPlan(actor, communityId, input) {
      const parsed = parse(upsertPlanInputSchema, input);
      const saved = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "edit_plan", "payment", context);
          if (community.archived) {
            throw new CommunityArchivedCheckoutError();
          }
          await store.enableManagement();
          const connection = await store.findOpenConnection();
          const active = await store.findActivePlan();
          if (!active && !canSell(connection)) {
            const issues = planPriceIssues(parsed);
            if (issues.length > 0) {
              throw new PaymentsValidationError(issues);
            }
            const draft = await store.findDraftPlan();
            const prices = {
              name: parsed.name,
              currency: parsed.currency,
              monthlyPriceMinor: parsed.monthlyPriceMinor,
              annualPriceMinor: parsed.annualPriceMinor,
            };
            return {
              kind: "draft" as const,
              plan: draft
                ? await store.updateDraftPlan(draft.id, prices)
                : await store.insertPlan({ id: runtime.newId(), connectionId: null, ...prices }),
            };
          }
          if (!connection?.externalAccountId) {
            throw new NotConnectedError();
          }
          if (awaitsOwnerReview(connection, await store.findOwnerId())) {
            throw new PaymentAccountReviewRequiredError();
          }
          if (active && active.currency !== parsed.currency) {
            throw new CurrencyLockedError();
          }
          if (active && active.connectionId === connection.id && samePrices(active, parsed)) {
            return { kind: "on_sale" as const, plan: active, connection, replaced: null };
          }
          const issues = planPriceIssues(parsed);
          if (issues.length > 0) {
            throw new PaymentsValidationError(issues);
          }
          const previous = active ?? (await store.findDraftPlan());
          if (previous) {
            await store.updatePlan(previous.id, { archivedAt: runtime.now() });
          }
          const plan = await store.insertPlan({
            id: runtime.newId(),
            connectionId: connection.id,
            name: parsed.name,
            currency: parsed.currency,
            monthlyPriceMinor: parsed.monthlyPriceMinor,
            annualPriceMinor: parsed.annualPriceMinor,
          });
          await store.setCommunityCurrency(parsed.currency);
          return { kind: "on_sale" as const, plan, connection, replaced: active };
        },
      );
      if (saved.kind === "draft") {
        return toDraftPlanView(saved.plan);
      }
      const { plan, connection, replaced } = saved;
      const named = plan.name === parsed.name ? plan : await rename(plan, connection, parsed.name);
      const provisioned = await provision(named, connection);
      if (replaced) {
        await deactivatePrices(replaced, connection);
      }
      return toPlanView(provisioned, connection, connection.acceptedOwnerId);
    },

    async archivePlan(actor, communityId) {
      const { plan, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, context }) => {
          assertCan(actor, "edit_plan", "payment", context);
          await store.enableManagement();
          const plan = (await store.findActivePlan()) ?? (await store.findDraftPlan());
          if (!plan) {
            throw new PaymentsNotFoundError("plan");
          }
          const archived = await store.updatePlan(plan.id, { archivedAt: runtime.now() });
          if (plan.connectionId !== null) {
            await store.setCommunityCurrency(null);
          }
          return { plan: archived, connection: await store.findOpenConnection() };
        },
      );
      await deactivatePrices(plan, connection);
    },
  };
}
