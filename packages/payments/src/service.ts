import { getDb } from "@cohory/db";
import { parseEmailEnv } from "@cohory/email";

import { isBillingSuspended } from "./billing/service";
import { parsePaymentsEnv } from "./config";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { rotatePaymentSecrets, type SecretRotationResult } from "./rotation";
import {
  createClosedBillingOperations,
  type ClosedBillingOperations,
} from "./service/closed-billing";
import { createCompOperations, type CompOperations } from "./service/comps";
import { createConnectionOperations, type ConnectionOperations } from "./service/connection";
import { createErasureOperations, type ErasureOperations } from "./service/erasure";
import { createExitOperations, type ExitOperations } from "./service/exit";
import { createHoldOperations, type HoldOperations } from "./service/holds";
import {
  createRenewalReminderOperations,
  type RenewalReminderOperations,
} from "./service/renewal-reminders";
import {
  createMemberBillingOperations,
  type MemberBillingOperations,
} from "./service/member-billing";
import { createRuntime, type PaymentsServiceDeps } from "./service/context";
import { createLinkingOperations, type LinkingOperations } from "./service/linking";
import {
  createMemberAccessSummaryOperations,
  type MemberAccessSummaryOperations,
} from "./service/member-access-summary";
import {
  createMemberRemovalOperations,
  type MemberRemovalOperations,
} from "./service/member-removal";
import { createMembershipOperations, type MembershipOperations } from "./service/membership";
import { createMetricsOperations, type MetricsOperations } from "./service/metrics";
import { createMovingOperations, type MovingOperations } from "./service/moves";
import { createOffboardingOperations, type OffboardingOperations } from "./service/offboarding";
import { createOwnershipOperations, type OwnershipOperations } from "./service/ownership";
import { createPlanOperations, type PlanOperations } from "./service/plans";
import {
  createProviderConnectionOperations,
  type ProviderConnectionOperations,
} from "./service/provider-connection";
import { createReconcileOperations, type ReconcileOperations } from "./service/reconcile";
import { createReportOperations, type ReportOperations } from "./service/reports";
import { createTenureOperations, type TenureOperations } from "./service/tenure";
import { createWebhookSweepOperations, type WebhookSweepOperations } from "./service/webhook-sweep";
import { createWebhookOperations, type WebhookOperations } from "./service/webhooks";
import { createPgBossPaymentsJobs } from "./jobs-pg-boss";
import { createPolarProvider } from "./providers/polar/adapter";
import { createStripeGateway, verifyStripeWebhook } from "./stripe-gateway";

export type PaymentsService = ConnectionOperations &
  ProviderConnectionOperations &
  PlanOperations &
  MembershipOperations &
  MemberBillingOperations &
  MemberRemovalOperations &
  MemberAccessSummaryOperations &
  ReportOperations &
  MetricsOperations &
  OffboardingOperations &
  OwnershipOperations &
  CompOperations &
  HoldOperations &
  RenewalReminderOperations &
  ClosedBillingOperations &
  ErasureOperations &
  ExitOperations &
  LinkingOperations &
  MovingOperations &
  TenureOperations &
  WebhookOperations &
  WebhookSweepOperations &
  ReconcileOperations;

export function createPaymentsService(deps: PaymentsServiceDeps): PaymentsService {
  const runtime = createRuntime(deps);
  return {
    ...createConnectionOperations(runtime),
    ...createProviderConnectionOperations(runtime),
    ...createPlanOperations(runtime),
    ...createMembershipOperations(runtime),
    ...createMemberBillingOperations(runtime),
    ...createMemberRemovalOperations(runtime),
    ...createMemberAccessSummaryOperations(runtime),
    ...createReportOperations(runtime),
    ...createMetricsOperations(runtime),
    ...createOffboardingOperations(runtime),
    ...createOwnershipOperations(runtime),
    ...createCompOperations(runtime),
    ...createHoldOperations(runtime),
    ...createRenewalReminderOperations(runtime),
    ...createClosedBillingOperations(runtime),
    ...createErasureOperations(runtime),
    ...createExitOperations(runtime),
    ...createLinkingOperations(runtime),
    ...createMovingOperations(runtime),
    ...createTenureOperations(runtime),
    ...createWebhookOperations(runtime),
    ...createWebhookSweepOperations(runtime),
    ...createReconcileOperations(runtime),
  };
}

let defaultService: PaymentsService | undefined;

export function getPaymentsService(): PaymentsService {
  if (!defaultService) {
    const env = parsePaymentsEnv();
    defaultService = createPaymentsService({
      repo: createPostgresPaymentsRepository(getDb()),
      env,
      platformGateway: env.stripeSecretKey
        ? createStripeGateway(env.stripeSecretKey, { apiBaseUrl: env.stripeApiBaseUrl })
        : null,
      gatewayForSecret: (secretKey) =>
        createStripeGateway(secretKey, { apiBaseUrl: env.stripeApiBaseUrl }),
      verifyWebhook: verifyStripeWebhook,
      jobs: createPgBossPaymentsJobs(),
      isBillingSuspended,
      requireConfirmedEmail: parseEmailEnv().driver === "smtp",
      providers: [
        createPolarProvider({
          apiBaseUrl: env.polarApiBaseUrl,
          fetch: globalThis.fetch.bind(globalThis),
          now: () => new Date(),
        }),
      ],
    });
  }
  return defaultService;
}

export function rotateStoredPaymentSecrets(): Promise<SecretRotationResult | null> {
  return rotatePaymentSecrets({
    repo: createPostgresPaymentsRepository(getDb()),
    keys: parsePaymentsEnv().encryptionKeys,
  });
}
