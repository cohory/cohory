import { assertCan, type Actor } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";

import {
  EditionMismatchError,
  NotConnectedError,
  PaymentsUnavailableError,
  StripeRejectedError,
} from "../errors";
import type { GatewaySubscriptionSummary } from "../gateway";
import { previewSubscriber, type MatchCandidate, type MatchContext } from "../linking/match";
import {
  discoverSubscriptionsInputSchema,
  linkSubscriptionsInputSchema,
  type DiscoverSubscriptionsInput,
  type LinkSubscriptionsInput,
} from "../linking/schemas";
import {
  normalizeEmail,
  toDiscoveredSubscriber,
  type ClaimResult,
  type DiscoveryPlan,
  type LinkResult,
  type LinkRowResult,
  type SubscriberDiscovery,
  type SubscriptionLinkView,
} from "../linking/views";
import type { ConnectionRecord, PaymentsStore } from "../repository";
import {
  callStripe,
  feeBpsFor,
  providerFor,
  parse,
  requireUserId,
  splitsFees,
  withAccess,
  type Runtime,
} from "./context";
import { applyLink, finishLink, linkFeeBps } from "./link-apply";

export interface LinkingOperations {
  discoverSubscriptions(
    actor: Actor,
    communityId: string,
    input?: DiscoverSubscriptionsInput,
  ): Promise<SubscriberDiscovery>;
  linkSubscriptions(
    actor: Actor,
    communityId: string,
    input: LinkSubscriptionsInput,
  ): Promise<LinkResult>;
  listSubscriptionLinks(actor: Actor, communityId: string): Promise<SubscriptionLinkView[]>;
  claimInvitedSubscriptions(actor: Actor, communityId: string): Promise<ClaimResult>;
}

export const subscriptionLinkListLimit = 200;

export const linkableStatuses: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

function assertLinkingOffered(runtime: Runtime): void {
  if (!runtime.env.subscriptionLinking) {
    throw new EditionMismatchError("community");
  }
}

export function requireLinkableConnection(connection: ConnectionRecord | null): ConnectionRecord {
  if (!connection?.externalAccountId || connection.status === "disconnected") {
    throw new NotConnectedError();
  }
  return connection;
}

export async function loadMatchContext(
  runtime: Runtime,
  store: PaymentsStore,
  connection: ConnectionRecord,
  summaries: readonly GatewaySubscriptionSummary[],
): Promise<MatchContext> {
  const emails = [
    ...new Set(
      summaries
        .map((summary) => normalizeEmail(summary.customerEmail))
        .filter((email): email is string => email !== null),
    ),
  ];
  const ids = summaries.map((summary) => summary.id);
  const users = await store.links.matchUsersByEmail(emails);
  const mirrored = await store.findMirroredExternalIds(ids);
  const links = await store.links.statuses(ids);
  const customerOwners = await store.links.customerOwners(
    connection.id,
    summaries.map((summary) => summary.customerId),
  );
  const plan = await store.findActivePlan();
  const bannedEmails = await store.links.bannedEmails(emails);
  return {
    communityId: store.communityId,
    usersByEmail: new Map<string, MatchCandidate>(users.map((row) => [row.email, row])),
    mirrored: new Set([
      ...mirrored,
      ...[...links].filter(([, status]) => status === "linked").map(([id]) => id),
    ]),
    invited: new Set([...links].filter(([, status]) => status === "invited").map(([id]) => id)),
    customerOwners,
    bannedEmails,
    ownApplicationId: runtime.providers.find(connection.provider)?.applicationId ?? null,
    matchOutsiders: runtime.env.edition === "community",
    plan: plan
      ? { monthlyPriceId: plan.providerMonthlyPriceId, annualPriceId: plan.providerAnnualPriceId }
      : null,
  };
}

function planFor(
  plan: Awaited<ReturnType<PaymentsStore["findActivePlan"]>>,
  connection: ConnectionRecord,
): string | null {
  return plan && plan.connectionId === connection.id ? plan.id : null;
}

function refused(
  subscriptionId: string,
  email: string | null,
  outcome: LinkRowResult["outcome"],
  reason: LinkRowResult["reason"] = null,
): LinkRowResult {
  return { subscriptionId, email, outcome, reason, platformFeeAdded: false };
}

export function createLinkingOperations(runtime: Runtime): LinkingOperations {
  async function fetchSummary(
    connection: ConnectionRecord,
    subscriptionId: string,
  ): Promise<GatewaySubscriptionSummary | null> {
    const { provider, conn } = providerFor(runtime, connection);
    const getSummary = provider.getSubscriptionSummary?.bind(provider);
    if (!getSummary) {
      throw new PaymentsUnavailableError("subscription import");
    }
    try {
      return await callStripe(runtime, () => getSummary(subscriptionId, conn));
    } catch (error: unknown) {
      if (error instanceof StripeRejectedError && error.stripeCode === "resource_missing") {
        return null;
      }
      throw error;
    }
  }

  async function linkRow(
    communityId: CommunityId,
    actorId: string,
    connection: ConnectionRecord,
    row: { subscriptionId: string; action: string; interval?: "month" | "year" | null },
    requestedFee: boolean,
  ): Promise<LinkRowResult> {
    if (row.action === "skip") {
      return refused(row.subscriptionId, null, "skipped");
    }
    const action =
      row.action === "link_and_add" && runtime.env.edition === "cloud" ? "invite" : row.action;
    const summary = await fetchSummary(connection, row.subscriptionId);
    if (!summary) {
      return refused(row.subscriptionId, null, "refused", "not_found");
    }
    const email = normalizeEmail(summary.customerEmail);
    if (!linkableStatuses.has(summary.status)) {
      return refused(summary.id, email, "refused", "status");
    }
    const interval = row.interval ?? "month";
    const feeBps = linkFeeBps(runtime, connection, requestedFee);
    const outcome = await runtime.repo.inCommunity(communityId, actorId, async (store) => {
      await store.enableManagement();
      const preview = previewSubscriber(
        summary,
        await loadMatchContext(runtime, store, connection, [summary]),
      );
      if (preview.block === "already_linked" || preview.block === "invited") {
        return {
          kind: "done" as const,
          result: refused(summary.id, email, "already_linked", preview.block),
        };
      }
      if (preview.block) {
        return {
          kind: "done" as const,
          result: refused(summary.id, email, "refused", preview.block),
        };
      }
      if (!email || !preview.allowed.some((allowed) => allowed === action)) {
        return {
          kind: "done" as const,
          result: refused(summary.id, email, "refused", "match_changed"),
        };
      }
      const planId = planFor(await store.findActivePlan(), connection);
      if (action === "invite") {
        const inserted = await store.links.insert({
          connectionId: connection.id,
          externalSubscriptionId: summary.id,
          externalCustomerId: summary.customerId,
          externalPriceId: summary.priceId,
          email,
          planId,
          interval,
          status: "invited",
          userId: null,
          subscriptionId: null,
          applicationFeeBps: feeBps,
          createdBy: actorId,
          linkedAt: null,
        });
        if (!inserted) {
          return {
            kind: "done" as const,
            result: refused(summary.id, email, "already_linked", "invited"),
          };
        }
        await store.links.appendAudit({
          actorId,
          action: "subscription.invited",
          target: inserted.id,
          metadata: { externalSubscriptionId: summary.id, interval, platformFeeBps: feeBps },
        });
        return { kind: "done" as const, result: refused(summary.id, email, "invited") };
      }
      const userId =
        preview.match.kind === "member" || preview.match.kind === "user"
          ? preview.match.userId
          : null;
      if (!userId) {
        return {
          kind: "done" as const,
          result: refused(summary.id, email, "refused", "match_changed"),
        };
      }
      const applied = await applyLink(runtime, store, {
        connection,
        summary,
        email,
        userId,
        interval,
        planId,
        feeBps,
        actorId,
        inviteId: null,
      });
      if (applied.kind !== "linked") {
        return {
          kind: "done" as const,
          result: refused(
            summary.id,
            email,
            applied.kind === "already_linked" ? "already_linked" : "refused",
            applied.kind,
          ),
        };
      }
      return {
        kind: "applied" as const,
        applied,
        outcome: action === "link_member" ? ("linked" as const) : ("added" as const),
      };
    });
    if (outcome.kind === "done") {
      return outcome.result;
    }
    const platformFeeAdded = await finishLink(
      runtime,
      communityId,
      connection,
      outcome.applied,
      feeBps,
    );
    return {
      subscriptionId: summary.id,
      email,
      outcome: outcome.outcome,
      reason: null,
      platformFeeAdded,
    };
  }

  return {
    async discoverSubscriptions(actor, communityId, input = {}) {
      const { cursor, limit } = parse(discoverSubscriptionsInputSchema, input);
      const { community, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "link_subscriptions", "payment", context);
          assertLinkingOffered(runtime);
          await store.enableManagement();
          return {
            community,
            connection: requireLinkableConnection(await store.findOpenConnection()),
          };
        },
      );
      const { provider, conn } = providerFor(runtime, connection);
      const list = provider.listSubscriptions?.bind(provider);
      if (!list) {
        throw new PaymentsUnavailableError("subscription import");
      }
      const page = await callStripe(runtime, () => list(conn, { startingAfter: cursor, limit }));
      const items = page.items.filter((item) => linkableStatuses.has(item.status));
      const { context, plan } = await runtime.repo.inCommunity(
        community.id,
        null,
        async (store) => {
          await store.enableManagement();
          const active = await store.findActivePlan();
          const discoveryPlan: DiscoveryPlan | null = active
            ? {
                name: active.name,
                currency: active.currency,
                monthlyPriceMinor: active.monthlyPriceMinor,
                annualPriceMinor: active.providerAnnualPriceId ? active.annualPriceMinor : null,
              }
            : null;
          return {
            context: await loadMatchContext(runtime, store, connection, items),
            plan: discoveryPlan,
          };
        },
      );
      const feeBps = feeBpsFor(runtime, connection);
      return {
        rows: items.map((item) => toDiscoveredSubscriber(item, previewSubscriber(item, context))),
        nextCursor: page.nextCursor,
        plan,
        edition: runtime.env.edition,
        platformFeeBps: feeBps,
        canAddPlatformFee: splitsFees(runtime, connection) && feeBps > 0,
      };
    },

    async linkSubscriptions(actor, communityId, input) {
      const actorId = requireUserId(actor);
      const { rows, addPlatformFee } = parse(linkSubscriptionsInputSchema, input);
      const { community, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "link_subscriptions", "payment", context);
          assertLinkingOffered(runtime);
          await store.enableManagement();
          return {
            community,
            connection: requireLinkableConnection(await store.findOpenConnection()),
          };
        },
      );
      const results: LinkRowResult[] = [];
      for (const row of rows) {
        results.push(await linkRow(community.id, actorId, connection, row, addPlatformFee));
      }
      const linked = results.filter((row) => row.outcome === "linked" || row.outcome === "added");
      if (linked.length > 0 || results.some((row) => row.outcome === "invited")) {
        runtime.log({
          msg: "existing subscriptions linked",
          communityId: community.id,
          linked: linked.length,
          invited: results.filter((row) => row.outcome === "invited").length,
        });
      }
      return {
        rows: results,
        invitedEmails: results
          .filter((row) => row.outcome === "invited")
          .map((row) => row.email)
          .filter((email): email is string => email !== null),
      };
    },

    async listSubscriptionLinks(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "link_subscriptions", "payment", context);
        await store.enableManagement();
        return (await store.links.list(subscriptionLinkListLimit)).map((link) => ({
          id: link.id,
          externalSubscriptionId: link.externalSubscriptionId,
          email: link.email,
          status: link.status,
          interval: link.interval,
          platformFeeBps: link.applicationFeeBps,
          linkedAt: link.linkedAt,
          createdAt: link.createdAt,
        }));
      });
    },

    async claimInvitedSubscriptions(actor, communityId) {
      const userId = requireUserId(actor);
      const { community, banned } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ community, member, context }) => {
          assertCan(actor, "read_own", "payment", context);
          assertLinkingOffered(runtime);
          return { community, banned: member?.status === "banned" };
        },
      );
      const none: ClaimResult = { claimed: 0, waitingForVerification: false };
      if (banned) {
        return none;
      }
      const { identity, invites } = await runtime.repo.inCommunityAsSystem(
        community.id,
        async (store) => {
          const identity = await store.links.findIdentity(userId);
          return {
            identity,
            invites: identity ? await store.links.listInvited(identity.email) : [],
          };
        },
      );
      if (!identity || invites.length === 0) {
        return none;
      }
      if (!identity.emailVerified) {
        return { claimed: 0, waitingForVerification: true };
      }
      let claimed = 0;
      for (const invite of invites) {
        const connection = await runtime.repo.findConnectionById(invite.connectionId);
        if (!connection || connection.status === "disconnected") {
          continue;
        }
        const summary = await fetchSummary(connection, invite.externalSubscriptionId);
        if (
          !summary ||
          !linkableStatuses.has(summary.status) ||
          normalizeEmail(summary.customerEmail) !== identity.email.toLowerCase()
        ) {
          continue;
        }
        const applied = await runtime.repo.inCommunityAsSystem(community.id, (store) =>
          applyLink(runtime, store, {
            connection,
            summary,
            email: identity.email.toLowerCase(),
            userId,
            interval: invite.interval,
            planId: invite.planId,
            feeBps: invite.applicationFeeBps,
            actorId: null,
            inviteId: invite.id,
          }),
        );
        if (applied.kind === "linked") {
          await finishLink(runtime, community.id, connection, applied, invite.applicationFeeBps);
          claimed += 1;
        }
      }
      return { claimed, waitingForVerification: false };
    },
  };
}
