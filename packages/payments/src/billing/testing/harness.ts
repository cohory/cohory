import type { CommunityId, Database } from "@cohory/db";
import type { EmailMessage } from "@cohory/email";
import { feeLedgerEntries, type FeeLedgerKind } from "@cohory/db/schema";

import type { PaymentsEnv } from "../../config";
import type { BillingWebhookEventJobPayload, PaymentsJobs } from "../../jobs";
import type { WebhookEventOutcome } from "../../service/webhooks";
import { createPostgresPaymentsRepository } from "../../postgres-repository";
import { verifyStripeWebhook } from "../../stripe-gateway";
import { cloudEnv } from "../../test/fixtures";
import { createPostgresBillingRepository } from "../postgres-store";
import type { ProviderTotalsSource } from "../runtime";
import { createPlatformBillingService, type PlatformBillingService } from "../service";
import { createFakeBillingGateway, type FakeBillingGateway } from "./fake-billing-gateway";

export interface BillingWorkerQueue {
  readonly billingEvents: BillingWebhookEventJobPayload[];
  runBillingWebhookJobs(): Promise<(WebhookEventOutcome | Error)[]>;
}

export interface BillingHarness {
  readonly queue: BillingWorkerQueue;
  readonly service: PlatformBillingService;
  readonly gateway: FakeBillingGateway;
  readonly clock: { now: Date };
  readonly emails: EmailMessage[];
  readonly logs: Record<string, unknown>[];
  readonly provider: { total: number | null };
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error("queue not available in this harness"));
}

export function createBillingHarness(
  db: Database,
  env: PaymentsEnv = cloudEnv(),
  options: { webhooks?: "inline" | "worker" } = {},
): BillingHarness {
  const gateway = createFakeBillingGateway();
  const emails: EmailMessage[] = [];
  const logs: Record<string, unknown>[] = [];
  const clock = { now: new Date("2026-11-01T00:10:00.000Z") };
  const provider: { total: number | null } = { total: null };
  const providerTotals: ProviderTotalsSource = () => Promise.resolve(provider.total);
  const queue: BillingWorkerQueue = {
    billingEvents: [],
    async runBillingWebhookJobs() {
      const due = queue.billingEvents.splice(0);
      const runs: (WebhookEventOutcome | Error)[] = [];
      for (const payload of due) {
        try {
          runs.push(await service.processBillingWebhookEvent(payload));
        } catch (error: unknown) {
          queue.billingEvents.push(payload);
          runs.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return runs;
    },
  };
  const jobs: PaymentsJobs | null =
    options.webhooks === "worker"
      ? {
          scheduleFeeRemoval: unavailable,
          scheduleExitRun: unavailable,
          scheduleMemberBillingEnd: unavailable,
          scheduleWebhookEvent: unavailable,
          scheduleConnectionReconcile: unavailable,
          scheduleRenewalReminder: unavailable,
          scheduleBillingWebhookEvent: async (payload) => {
            queue.billingEvents.push(payload);
          },
        }
      : null;
  const service = createPlatformBillingService({
    jobs,
    repo: createPostgresBillingRepository(db),
    paymentsRepo: createPostgresPaymentsRepository(db),
    env,
    gateway: env.stripeSecretKey ? gateway : null,
    sendEmail: async (message) => {
      emails.push(message);
    },
    providerTotals,
    verifyWebhook: verifyStripeWebhook,
    now: () => clock.now,
    log: (entry) => logs.push(entry),
  });
  return { service, gateway, clock, emails, logs, provider, queue };
}

let entryCounter = 0;

export interface AccrualInput {
  readonly feeMinor: number;
  readonly currency?: string;
  readonly occurredAt: Date;
  readonly kind?: FeeLedgerKind;
  readonly collectionMethod?: "automatic_split" | "periodic_invoice";
}

export async function insertAccrual(
  db: Database,
  communityId: CommunityId,
  input: AccrualInput,
): Promise<string> {
  entryCounter += 1;
  const kind = input.kind ?? "fee_accrued";
  const [row] = await db
    .insert(feeLedgerEntries)
    .values({
      communityId,
      kind,
      provider: "stripe_connect",
      collectionMethod: input.collectionMethod ?? "periodic_invoice",
      currency: input.currency ?? "usd",
      baseMinor: kind === "fee_accrued" ? input.feeMinor * 50 : 0,
      rateBps: 200,
      computedFeeMinor: input.feeMinor,
      providerFeeMinor: null,
      externalRef: `pay_test_${entryCounter}`,
      idempotencyKey: `test:accrued:${communityId}:${entryCounter}:${Date.now()}`,
      occurredAt: input.occurredAt,
    })
    .returning({ id: feeLedgerEntries.id });
  if (!row) {
    throw new Error("ledger insert returned no row");
  }
  return row.id;
}
