import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema } from "@cohory/db";
import { z } from "zod";

import { accessStateFor, grants } from "../access";
import { memberBillingEndJobPayloadSchema } from "../jobs";
import type { MemberRecord, PaymentsStore, SubscriptionRecord } from "../repository";
import { callStripe, parse, providerFor, withAccess, type Runtime } from "./context";

export const memberRemovedByStaffEvent = "membership.removed_by_staff";

export type MemberRemovedByStaff = z.input<typeof memberBillingEndJobPayloadSchema>;

export type MemberBilling =
  | { readonly paying: false }
  | {
      readonly paying: true;
      readonly amountMinor: number | null;
      readonly currency: string | null;
      readonly interval: "month" | "year" | null;
    };

export interface MemberRemovalResult {
  readonly canceled: number;
}

export interface MemberRemovalOperations {
  getMemberBilling(actor: Actor, communityId: string, userId: string): Promise<MemberBilling>;
  requestBillingEndForRemovedMember(event: MemberRemovedByStaff): Promise<void>;
  endBillingForRemovedMember(event: MemberRemovedByStaff): Promise<MemberRemovalResult>;
}

const maxSubscriptionsPerMember = 10;

function removedByStaff(member: MemberRecord | null): boolean {
  return (
    member?.status === "banned" ||
    (member?.status === "removed" && member.removalReason === "removed")
  );
}

async function grantingSubscription(
  store: PaymentsStore,
  userId: string,
): Promise<SubscriptionRecord | null> {
  const subscription = await store.findSubscriptionForUser(userId);
  return subscription && grants(subscription.accessState) ? subscription : null;
}

export function createMemberRemovalOperations(runtime: Runtime): MemberRemovalOperations {
  const { repo } = runtime;

  const operations: MemberRemovalOperations = {
    async requestBillingEndForRemovedMember(input) {
      const event = parse(memberBillingEndJobPayloadSchema, input);
      if (runtime.jobs) {
        try {
          await runtime.jobs.scheduleMemberBillingEnd(event);
          return;
        } catch (error: unknown) {
          runtime.log({
            msg: "member billing end job could not be scheduled, running inline",
            level: "warn",
            communityId: event.communityId,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      await operations.endBillingForRemovedMember(event);
    },

    async getMemberBilling(actor, communityId, userId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "manage", "membership", context);
        await store.enableManagement();
        const subscription = z.uuid().safeParse(userId).success
          ? await grantingSubscription(store, userId)
          : null;
        if (!subscription) {
          return { paying: false };
        }
        const plan = subscription.planId ? await store.findPlan(subscription.planId) : null;
        const prices = { month: plan?.monthlyPriceMinor, year: plan?.annualPriceMinor };
        const amountMinor = subscription.interval ? (prices[subscription.interval] ?? null) : null;
        return {
          paying: true,
          amountMinor,
          currency: amountMinor === null ? null : (plan?.currency ?? null),
          interval: subscription.interval,
        };
      });
    },

    async endBillingForRemovedMember(input) {
      const event = parse(memberBillingEndJobPayloadSchema, input);
      const communityId = communityIdSchema.parse(event.communityId);
      const canceled = new Set<string>();
      for (let round = 0; round < maxSubscriptionsPerMember; round += 1) {
        const due = await repo.inCommunityAsSystem(communityId, async (store) =>
          removedByStaff(await store.findMember(event.userId))
            ? grantingSubscription(store, event.userId)
            : null,
        );
        if (!due || canceled.has(due.id)) {
          break;
        }
        const connection = await repo.findConnectionById(due.connectionId);
        if (!connection) {
          runtime.log({
            msg: "no connection to end a removed member's subscription",
            level: "error",
            communityId,
            subscriptionId: due.id,
          });
          break;
        }
        const { provider, conn } = providerFor(runtime, connection);
        const ended = await callStripe(runtime, () =>
          provider.cancelSubscription(
            due.externalSubscriptionId,
            { atPeriodEnd: false, idempotencyKey: `staff-removal:${due.id}` },
            conn,
          ),
        );
        const accessState = accessStateFor(ended.status);
        await repo.inCommunityAsSystem(communityId, (store) =>
          store.setSubscriptionAccessState(due.id, accessState),
        );
        const stillGrants = grants(accessState);
        runtime.log({
          msg: stillGrants
            ? "a removed member's subscription is still active after cancel"
            : "ended a subscription after staff removed the member",
          level: stillGrants ? "error" : "info",
          event: memberRemovedByStaffEvent,
          communityId,
          subscriptionId: due.id,
          kind: event.kind,
        });
        if (stillGrants) {
          break;
        }
        canceled.add(due.id);
      }
      return { canceled: canceled.size };
    },
  };
  return operations;
}
