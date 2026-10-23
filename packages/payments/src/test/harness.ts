import { randomUUID } from "node:crypto";

import { newId, type CommunityId, type Database } from "@cohory/db";
import {
  paymentConnections,
  paymentCustomers,
  subscriptions,
  type SubscriptionAccessState,
} from "@cohory/db/schema";
import { and, eq, ne } from "drizzle-orm";

import type { PaymentsEnv } from "../config";
import type { GatewaySubscription, GatewaySubscriptionSummary } from "../gateway";
import type {
  BillingWebhookEventJobPayload,
  PaymentsJobs,
  ReconcileConnectionJobPayload,
  WebhookEventJobPayload,
} from "../jobs";
import { createPostgresPaymentsRepository } from "../postgres-repository";
import { createFakeProvider, type FakeProvider } from "../providers/fake/adapter";
import type { BillingSuspensionCheck } from "../service/context";
import type { PaymentsRepository, SubscriptionRecord } from "../repository";
import { createPaymentsService, type PaymentsService } from "../service";
import type { WebhookEventOutcome } from "../service/webhooks";
import { verifyStripeWebhook } from "../stripe-gateway";
import type { SubscriptionOrigin } from "../tenure/store";
import { createFakeGateway, type FakeGateway } from "./fake-gateway";
import { cloudEnv, insertCommunity, insertMember, insertUser, user } from "./fixtures";

export interface Clock {
  now: Date;
}

export type WebhookJobRun = WebhookEventOutcome | Error;

export interface WorkerQueue {
  readonly webhookEvents: WebhookEventJobPayload[];
  readonly billingEvents: BillingWebhookEventJobPayload[];
  readonly reconciles: ReconcileConnectionJobPayload[];
  down: boolean;
  runWebhookJobs(): Promise<WebhookJobRun[]>;
}

export interface Harness {
  readonly service: PaymentsService;
  readonly gateway: FakeGateway;
  readonly provider: FakeProvider;
  readonly clock: Clock;
  readonly logs: Record<string, unknown>[];
  readonly queue: WorkerQueue;
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error("queue not available in this harness"));
}

function workerJobs(
  jobs: PaymentsJobs | null,
  queue: WorkerQueue,
  mode: "inline" | "worker",
  service: () => PaymentsService,
): PaymentsJobs | null {
  if (mode === "inline") {
    return (
      jobs && {
        ...jobs,
        scheduleWebhookEvent: async (payload) => {
          await service().processWebhookEvent(payload);
        },
      }
    );
  }
  return {
    scheduleFeeRemoval: unavailable,
    scheduleExitRun: unavailable,
    scheduleMemberBillingEnd: unavailable,
    scheduleRenewalReminder: unavailable,
    ...jobs,
    scheduleBillingWebhookEvent: async (payload) => {
      queue.billingEvents.push(payload);
    },
    scheduleWebhookEvent: async (payload) => {
      if (queue.down) {
        throw new Error("queue is down");
      }
      queue.webhookEvents.push(payload);
    },
    scheduleConnectionReconcile: async (payload) => {
      queue.reconciles.push(payload);
    },
  };
}

export function createHarness(
  db: Database,
  env: PaymentsEnv = cloudEnv(),
  jobs: PaymentsJobs | null = null,
  options: {
    isBillingSuspended?: BillingSuspensionCheck;
    requireConfirmedEmail?: boolean;
    wrapRepo?: (repo: PaymentsRepository) => PaymentsRepository;
    webhooks?: "inline" | "worker";
  } = {},
): Harness {
  const gateway = createFakeGateway();
  const clock: Clock = { now: new Date("2026-10-18T10:00:00.000Z") };
  const logs: Record<string, unknown>[] = [];
  const provider = createFakeProvider();
  const webhookPath = /\/api\/webhooks\/payments\/([^/]+)$/;
  const routeWebhook: typeof fetch = async (input, init) => {
    const match = webhookPath.exec(String(input));
    if (!match?.[1] || typeof init?.body !== "string") {
      return new Response(null, { status: 404 });
    }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const result = await service.handleWebhook(
      { setup: "access_token", connectionId: match[1] },
      {
        rawBody: init.body,
        headers,
      },
    );
    return Response.json({ outcome: result.outcome }, { status: result.status });
  };
  const {
    wrapRepo = (repo: PaymentsRepository) => repo,
    webhooks = "inline",
    ...serviceOptions
  } = options;
  const queue: WorkerQueue = {
    webhookEvents: [],
    billingEvents: [],
    reconciles: [],
    down: false,
    async runWebhookJobs() {
      const due = queue.webhookEvents.splice(0);
      const runs: WebhookJobRun[] = [];
      for (const payload of due) {
        try {
          runs.push(await service.processWebhookEvent(payload));
        } catch (error: unknown) {
          queue.webhookEvents.push(payload);
          runs.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return runs;
    },
  };
  const service: PaymentsService = createPaymentsService({
    repo: wrapRepo(createPostgresPaymentsRepository(db)),
    env,
    platformGateway: env.stripeSecretKey ? gateway : null,
    gatewayForSecret: () => gateway,
    verifyWebhook: verifyStripeWebhook,
    jobs: workerJobs(jobs, queue, webhooks, () => service),
    providers: [provider],
    ...serviceOptions,
    fetch: routeWebhook,
    now: () => clock.now,
    log: (entry) => logs.push(entry),
  });
  return { service, gateway, provider, clock, logs, queue };
}

export interface PaidCommunity {
  readonly communityId: CommunityId;
  readonly accountId: string;
  readonly connectionId: string;
  readonly ownerId: string;
  readonly adminId: string;
  readonly memberId: string;
  readonly buyerId: string;
  readonly planId: string;
}

export async function setupPaidCommunity(
  admin: Database,
  harness: Harness,
  privacy: "public" | "private" = "public",
): Promise<PaidCommunity> {
  const communityId = await insertCommunity(admin, privacy);
  const ownerId = await insertMember(admin, communityId, "owner");
  const adminId = await insertMember(admin, communityId, "admin");
  const memberId = await insertMember(admin, communityId, "member");
  const buyerId = await insertUser(admin);
  const owner = user(ownerId);
  const { connection } = await harness.service.connectStripe(owner, communityId, {
    acceptCreatorTerms: true,
  });
  const accountId = connection.externalAccountId ?? "";
  harness.gateway.accounts.set(accountId, {
    id: accountId,
    chargesEnabled: true,
    detailsSubmitted: true,
    livemode: false,
    country: "us",
  });
  await harness.service.refreshConnection(owner, communityId);
  const plan = await harness.service.upsertPlan(owner, communityId, {
    currency: "USD",
    monthlyPriceMinor: 4900,
    annualPriceMinor: 49_000,
  });
  return {
    communityId,
    accountId,
    connectionId: connection.id,
    ownerId,
    adminId,
    memberId,
    buyerId,
    planId: plan.id,
  };
}

const run = randomUUID().slice(0, 8);
let subscriptionCounter = 0;

export function stripeSubscription(
  paid: PaidCommunity,
  userId: string,
  overrides: Partial<GatewaySubscription> = {},
): GatewaySubscription {
  subscriptionCounter += 1;
  return {
    id: `sub_${run}${subscriptionCounter}`,
    status: "active",
    customerId: `cus_${run}${subscriptionCounter}`,
    metadata: {
      cohory_community_id: paid.communityId,
      cohory_user_id: userId,
      cohory_plan_id: paid.planId,
    },
    currentPeriodEnd: new Date("2026-11-18T10:00:00.000Z"),
    cancelAtPeriodEnd: false,
    endedAt: null,
    interval: "month",
    applicationFeePercent: 2,
    priceId: null,
    ...overrides,
  };
}

export interface ExistingSubscriber {
  readonly summary: GatewaySubscriptionSummary;
  readonly subscription: GatewaySubscription;
}

export function existingSubscriber(
  gateway: FakeGateway,
  email: string | null,
  overrides: Partial<GatewaySubscriptionSummary> = {},
): ExistingSubscriber {
  subscriptionCounter += 1;
  const id = overrides.id ?? `sub_old${run}${subscriptionCounter}`;
  const summary: GatewaySubscriptionSummary = {
    id,
    status: "active",
    customerId: `cus_old${run}${subscriptionCounter}`,
    customerEmail: email,
    customerName: "Existing subscriber",
    priceId: `price_old${run}`,
    unitAmountMinor: 2900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    currentPeriodEnd: new Date("2026-11-02T10:00:00.000Z"),
    cancelAtPeriodEnd: false,
    createdByApplication: null,
    metadata: {},
    applicationFeePercent: null,
    ...overrides,
  };
  const subscription: GatewaySubscription = {
    id,
    status: summary.status,
    customerId: summary.customerId,
    metadata: summary.metadata,
    currentPeriodEnd: summary.currentPeriodEnd,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    endedAt: null,
    interval: summary.interval === "month" || summary.interval === "year" ? summary.interval : null,
    applicationFeePercent: summary.applicationFeePercent,
    priceId: summary.priceId,
  };
  gateway.summaries.set(id, summary);
  gateway.subscriptions.set(id, subscription);
  return { summary, subscription };
}

export interface MirroredSubscriptionInput {
  readonly userId?: string;
  readonly connectionId?: string;
  readonly planId?: string | null;
  readonly origin?: SubscriptionOrigin;
  readonly providerStatus?: string;
  readonly accessState?: SubscriptionAccessState;
  readonly currentPeriodEnd?: Date | null;
  readonly cancelAtPeriodEnd?: boolean;
  readonly applicationFeeBps?: number;
}

async function openConnectionId(admin: Database, communityId: CommunityId): Promise<string> {
  const [row] = await admin
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(
      and(
        eq(paymentConnections.communityId, communityId),
        ne(paymentConnections.status, "disconnected"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("community has no open payment connection");
  }
  return row.id;
}

export async function mirrorSubscription(
  admin: Database,
  communityId: CommunityId,
  input: MirroredSubscriptionInput = {},
): Promise<SubscriptionRecord> {
  const userId = input.userId ?? (await insertUser(admin));
  const connectionId = input.connectionId ?? (await openConnectionId(admin, communityId));
  const [customer] = await admin
    .insert(paymentCustomers)
    .values({ communityId, userId, connectionId, externalCustomerId: `cus_mirror${newId()}` })
    .returning({ id: paymentCustomers.id });
  const [row] = await admin
    .insert(subscriptions)
    .values({
      communityId,
      userId,
      customerId: customer?.id ?? "",
      connectionId,
      planId: input.planId ?? null,
      externalSubscriptionId: `sub_mirror${newId()}`,
      providerStatus: input.providerStatus ?? "active",
      accessState: input.accessState ?? "granted",
      interval: "month",
      currentPeriodEnd:
        input.currentPeriodEnd === undefined
          ? new Date("2026-11-18T10:00:00.000Z")
          : input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      applicationFeeBps: input.applicationFeeBps ?? 200,
      origin: input.origin ?? "created_by_cohory",
      providerFetchedAt: new Date("2026-10-18T10:00:00.000Z"),
    })
    .returning();
  if (!row) {
    throw new Error("subscription insert returned no row");
  }
  return row;
}
