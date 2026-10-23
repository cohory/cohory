import { getDb, type CommunityId } from "@cohory/db";
import { sendEmail } from "@cohory/email";

import { parsePaymentsEnv } from "../config";
import { createPgBossPaymentsJobs } from "../jobs-pg-boss";
import type { PaymentsJobs } from "../jobs";
import { createPostgresPaymentsRepository } from "../postgres-repository";
import { createRuntime } from "../service/context";
import type { PaymentsRepository } from "../repository";
import { verifyStripeWebhook } from "../stripe-gateway";
import { createAccountOperations } from "./accounts";
import { createInvoicing } from "./invoicing";
import { createPostgresBillingRepository } from "./postgres-store";
import { createReconciliation } from "./reconcile";
import { createBillingRuntime, type PlatformBillingDeps } from "./runtime";
import { createStripeBillingGateway } from "./stripe-billing-gateway";
import { createBillingWebhooks } from "./webhooks";

export interface PlatformBillingServiceDeps extends PlatformBillingDeps {
  readonly paymentsRepo: PaymentsRepository;
  readonly jobs?: PaymentsJobs | null;
}

export function createPlatformBillingService(deps: PlatformBillingServiceDeps) {
  const runtime = createBillingRuntime(deps);
  const payments = createRuntime({
    repo: deps.paymentsRepo,
    env: deps.env,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
  const invoicing = createInvoicing(runtime);
  const accounts = createAccountOperations({ runtime, payments, invoicing });
  const { reconcile } = createReconciliation(runtime, invoicing);
  const { handlePlatformBillingWebhook, processBillingWebhookEvent } = createBillingWebhooks(
    runtime,
    invoicing,
    accounts,
    { repo: deps.paymentsRepo, jobs: deps.jobs ?? null },
  );
  return {
    getPlatformFees: accounts.getPlatformFees,
    updateBillingEmail: accounts.updateBillingEmail,
    startPaymentMethodSetup: accounts.startPaymentMethodSetup,
    completePaymentMethodSetup: accounts.completePaymentMethodSetup,
    isBillingSuspended: accounts.isBillingSuspended,
    generateInvoices: invoicing.generateInvoices,
    voidPlatformInvoice: invoicing.voidInvoice,
    resendPlatformInvoice: invoicing.resendInvoice,
    syncPlatformInvoice: invoicing.syncInvoice,
    reconcile,
    handlePlatformBillingWebhook,
    processBillingWebhookEvent,
  };
}

export type PlatformBillingService = ReturnType<typeof createPlatformBillingService>;

let defaultService: PlatformBillingService | undefined;

export function getPlatformBillingService(): PlatformBillingService {
  if (!defaultService) {
    const env = parsePaymentsEnv();
    const db = getDb();
    defaultService = createPlatformBillingService({
      repo: createPostgresBillingRepository(db),
      paymentsRepo: createPostgresPaymentsRepository(db),
      env,
      gateway: env.stripeSecretKey
        ? createStripeBillingGateway(env.stripeSecretKey, { apiBaseUrl: env.stripeApiBaseUrl })
        : null,
      sendEmail,
      verifyWebhook: verifyStripeWebhook,
      jobs: createPgBossPaymentsJobs(),
    });
  }
  return defaultService;
}

export function isBillingSuspended(communityId: CommunityId): Promise<boolean> {
  return getPlatformBillingService().isBillingSuspended(communityId);
}
