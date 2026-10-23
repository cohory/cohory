import { createHash } from "node:crypto";

import { communityIdSchema } from "@cohory/db";
import { z } from "zod";

import { isLiveKey } from "../config";
import type { VerifiedEvent } from "../gateway";
import type { BillingWebhookEventJobPayload, PaymentsJobs } from "../jobs";
import type { PaymentsRepository, StoredEvent } from "../repository";
import {
  eventLeaseMs,
  WebhookEventBusyError,
  WebhookEventMismatchError,
  type WebhookEventOutcome,
  type WebhookRequest,
  type WebhookResult,
} from "../service/webhooks";
import { WebhookSignatureError } from "../stripe-gateway";
import type { AccountOperations } from "./accounts";
import type { Invoicing } from "./invoicing";
import { billingEnabled, requireGateway, type BillingRuntime } from "./runtime";

export const platformInvoiceEvents = [
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice.sent",
  "invoice.overdue",
] as const;

const metadataSchema = z.record(z.string(), z.string()).nullish();
const invoiceMetadataSchema = z.object({
  cohory_platform_invoice_id: z.uuid(),
  cohory_community_id: z.uuid(),
});
const setupMetadataSchema = z.object({
  cohory_billing_account_id: z.uuid(),
  cohory_community_id: z.uuid(),
});

type Route =
  | { readonly kind: "invoice"; readonly communityId: string; readonly invoiceId: string }
  | { readonly kind: "setup"; readonly communityId: string; readonly sessionId: string };

function routeOf(event: VerifiedEvent): Route | null {
  if (event.account) {
    return null;
  }
  const metadata = metadataSchema.safeParse(event.object["metadata"]);
  const values = metadata.success ? (metadata.data ?? {}) : {};
  if ((platformInvoiceEvents as readonly string[]).includes(event.type)) {
    const parsed = invoiceMetadataSchema.safeParse(values);
    return parsed.success
      ? {
          kind: "invoice",
          communityId: parsed.data.cohory_community_id,
          invoiceId: parsed.data.cohory_platform_invoice_id,
        }
      : null;
  }
  if (event.type === "checkout.session.completed" && event.object["mode"] === "setup") {
    const parsed = setupMetadataSchema.safeParse(values);
    return parsed.success
      ? { kind: "setup", communityId: parsed.data.cohory_community_id, sessionId: event.object.id }
      : null;
  }
  return null;
}

export interface BillingWebhookInbox {
  readonly repo: Pick<
    PaymentsRepository,
    "recordEvent" | "claimEvent" | "finishEvent" | "failEvent"
  >;
  readonly jobs: Pick<PaymentsJobs, "scheduleBillingWebhookEvent"> | null;
}

export function createBillingWebhooks(
  runtime: BillingRuntime,
  invoicing: Invoicing,
  accounts: AccountOperations,
  inbox: BillingWebhookInbox,
) {
  function verify(request: WebhookRequest): VerifiedEvent | null {
    const secrets = runtime.env.webhookSecrets;
    if (!runtime.verifyWebhook || !request.signature || secrets.length === 0) {
      return null;
    }
    try {
      return runtime.verifyWebhook(request.rawBody, request.signature, secrets);
    } catch (error: unknown) {
      if (error instanceof WebhookSignatureError || error instanceof z.ZodError) {
        return null;
      }
      throw error;
    }
  }

  async function handle(event: VerifiedEvent, route: Route): Promise<WebhookEventOutcome> {
    const communityId = communityIdSchema.parse(route.communityId);
    if (route.kind === "setup") {
      await accounts.completeSetup(communityId, route.sessionId);
      return "processed";
    }
    const invoice = await runtime.repo.asBilling(communityId, (store) =>
      store.findInvoice(route.invoiceId),
    );
    if (!invoice || invoice.stripeInvoiceId !== event.object.id) {
      return "ignored";
    }
    await invoicing.syncInvoice(
      communityId,
      route.invoiceId,
      event.type === "invoice.payment_failed",
    );
    return "processed";
  }

  async function claimAndProcess(
    rowId: string,
    load: (stored: StoredEvent) => Promise<VerifiedEvent>,
  ): Promise<WebhookEventOutcome> {
    const claim = await inbox.repo.claimEvent(rowId, runtime.now(), eventLeaseMs);
    if (claim.kind === "duplicate" || claim.kind === "missing") {
      return claim.kind === "duplicate" ? "duplicate" : "ignored";
    }
    if (claim.kind === "in_progress") {
      throw new WebhookEventBusyError();
    }
    const stored = claim.event;
    try {
      const event = await load(stored);
      const route = routeOf(event);
      const outcome = route ? await handle(event, route) : "ignored";
      const communityId = route ? communityIdSchema.parse(route.communityId) : null;
      await inbox.repo.finishEvent(stored.rowId, communityId, runtime.now());
      return outcome;
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "unknown";
      await inbox.repo.failEvent(stored.rowId, name);
      runtime.log({
        msg: "platform billing webhook failed",
        level: "error",
        eventId: stored.externalEventId,
        type: stored.type,
        error: name,
      });
      throw error;
    }
  }

  function processBillingWebhookEvent(
    payload: BillingWebhookEventJobPayload,
  ): Promise<WebhookEventOutcome> {
    return claimAndProcess(payload.providerEventId, async (stored) => {
      const event = await requireGateway(runtime).retrieveEvent(stored.externalEventId);
      if (event.id !== stored.externalEventId || event.type !== stored.type) {
        throw new WebhookEventMismatchError();
      }
      return event;
    });
  }

  async function processInline(rowId: string, event: VerifiedEvent): Promise<WebhookResult> {
    try {
      return { status: 200, outcome: await claimAndProcess(rowId, async () => event) };
    } catch (error: unknown) {
      return error instanceof WebhookEventBusyError
        ? { status: 409, outcome: "in_progress" }
        : { status: 500, outcome: "failed" };
    }
  }

  async function handlePlatformBillingWebhook(
    request: WebhookRequest,
  ): Promise<WebhookResult | null> {
    if (!billingEnabled(runtime) || !runtime.gateway || !runtime.env.stripeSecretKey) {
      return null;
    }
    const event = verify(request);
    const route = event ? routeOf(event) : null;
    if (!event || !route) {
      return null;
    }
    if (event.livemode !== isLiveKey(runtime.env.stripeSecretKey)) {
      return { status: 200, outcome: "ignored" };
    }
    const recorded = await inbox.repo.recordEvent({
      provider: "stripe_connect",
      externalEventId: event.id,
      externalAccountId: null,
      connectionId: null,
      type: event.type,
      livemode: event.livemode,
      payloadHash: createHash("sha256").update(request.rawBody).digest("hex"),
      now: runtime.now(),
    });
    if (recorded.processed) {
      return { status: 200, outcome: "duplicate" };
    }
    if (!inbox.jobs) {
      return processInline(recorded.rowId, event);
    }
    try {
      await inbox.jobs.scheduleBillingWebhookEvent({ providerEventId: recorded.rowId });
      return { status: 200, outcome: "queued" };
    } catch (error: unknown) {
      runtime.log({
        msg: "platform billing webhook could not be queued",
        level: "error",
        eventId: event.id,
        type: event.type,
        error: error instanceof Error ? error.name : "unknown",
      });
      return { status: 500, outcome: "failed" };
    }
  }

  return { handlePlatformBillingWebhook, processBillingWebhookEvent };
}
