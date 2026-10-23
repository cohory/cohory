import type { CommunityId } from "@cohory/db";
import type { EmailMessage } from "@cohory/email";
import { logger } from "@cohory/infra/logger";

import type { PaymentsEnv } from "../config";
import { PaymentsUnavailableError, StripeRejectedError } from "../errors";
import type { WebhookVerifier } from "../gateway";
import type { BillingGateway } from "./gateway";
import type { BillingRepository } from "./store";

export interface ProviderTotalsQuery {
  readonly communityId: CommunityId;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export type ProviderTotalsSource = (query: ProviderTotalsQuery) => Promise<number | null>;

export const noProviderTotals: ProviderTotalsSource = () => Promise.resolve(null);

export type LogEntry = Readonly<Record<string, string | number | boolean | null>>;

export interface PlatformBillingDeps {
  readonly repo: BillingRepository;
  readonly env: PaymentsEnv;
  readonly gateway: BillingGateway | null;
  readonly sendEmail?: (message: EmailMessage) => Promise<void>;
  readonly providerTotals?: ProviderTotalsSource;
  readonly verifyWebhook?: WebhookVerifier | null;
  readonly now?: () => Date;
  readonly log?: (entry: LogEntry) => void;
}

export interface BillingRuntime {
  readonly repo: BillingRepository;
  readonly env: PaymentsEnv;
  readonly gateway: BillingGateway | null;
  readonly sendEmail: (message: EmailMessage) => Promise<void>;
  readonly providerTotals: ProviderTotalsSource;
  readonly verifyWebhook: WebhookVerifier | null;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
}

export function createBillingRuntime(deps: PlatformBillingDeps): BillingRuntime {
  return {
    repo: deps.repo,
    env: deps.env,
    gateway: deps.gateway,
    sendEmail: deps.sendEmail ?? (() => Promise.resolve()),
    providerTotals: deps.providerTotals ?? noProviderTotals,
    verifyWebhook: deps.verifyWebhook ?? null,
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? ((entry) => logger.info(entry)),
  };
}

export function billingEnabled(runtime: BillingRuntime): boolean {
  return runtime.env.edition === "cloud";
}

export function requireGateway(runtime: BillingRuntime): BillingGateway {
  if (!runtime.gateway) {
    throw new PaymentsUnavailableError("STRIPE_SECRET_KEY");
  }
  return runtime.gateway;
}

function stripeCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "type" in error) {
    const { type } = error;
    if (typeof type === "string" && type.startsWith("Stripe")) {
      const code = "code" in error && typeof error.code === "string" ? error.code : null;
      return code ?? type;
    }
  }
  return null;
}

export async function callBillingStripe<T>(
  runtime: BillingRuntime,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const code = stripeCode(error);
    if (code === null) {
      throw error;
    }
    runtime.log({
      msg: "stripe rejected a platform billing request",
      level: "warn",
      operation,
      code,
    });
    throw new StripeRejectedError(code);
  }
}

export function periodLabel(start: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(start);
}
