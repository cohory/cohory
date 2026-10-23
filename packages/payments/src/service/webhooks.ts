import { createHash } from "node:crypto";

import { communityIdSchema } from "@cohory/db";
import { z } from "zod";

import { SecretDecryptionError } from "../crypto";
import { PaymentsUnavailableError } from "../errors";
import type { VerifiedEvent } from "../gateway";
import type { WebhookEventJobPayload } from "../jobs";
import type { Connection, ConnectionSetup, PaymentProvider, RawWebhook } from "../providers/types";
import type { ConnectionRecord, StoredEvent } from "../repository";
import { WebhookSignatureError } from "../stripe-gateway";
import { connectionFor, providerWithSetup, type Runtime } from "./context";
import { createExitWebhookHandlers, isFeeAfterExit } from "./exit-webhooks";
import { createNormalizedEventHandler } from "./normalized-events";

export type WebhookOutcome =
  | "processed"
  | "ignored"
  | "queued"
  | "duplicate"
  | "in_progress"
  | "invalid_signature"
  | "unknown_connection"
  | "not_configured"
  | "failed";

export interface WebhookResult {
  readonly status: 200 | 400 | 404 | 409 | 500 | 503;
  readonly outcome: WebhookOutcome;
}

export interface WebhookRequest {
  readonly rawBody: string;
  readonly signature: string | null;
}

export interface WebhookDelivery {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | null>>;
}

export type WebhookEventOutcome = "processed" | "ignored" | "duplicate";

type ConnectionWebhookSetup = Exclude<ConnectionSetup, "platform_account">;

export type WebhookTarget =
  | { readonly setup: "platform_account" }
  | { readonly setup: ConnectionWebhookSetup; readonly connectionId: string };

export class WebhookEventMismatchError extends Error {
  override readonly name = "WebhookEventMismatchError";

  constructor() {
    super("the fetched event does not match the stored event");
  }
}

export class WebhookEventBusyError extends Error {
  override readonly name = "WebhookEventBusyError";

  constructor() {
    super("webhook event is being processed by another worker");
  }
}

export interface WebhookOperations {
  handleWebhook(target: WebhookTarget, delivery: WebhookDelivery): Promise<WebhookResult>;
  processWebhookEvent(payload: WebhookEventJobPayload): Promise<WebhookEventOutcome>;
}

export const eventLeaseMs = 2 * 60_000;

const uuid = z.uuid();

const result = (status: WebhookResult["status"], outcome: WebhookOutcome): WebhookResult => ({
  status,
  outcome,
});

function rawWebhook(delivery: WebhookDelivery): RawWebhook {
  const headers = new Map(
    Object.entries(delivery.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { rawBody: delivery.rawBody, header: (name) => headers.get(name.toLowerCase()) ?? null };
}

export function createWebhookOperations(runtime: Runtime): WebhookOperations {
  const { repo } = runtime;
  const handle = createNormalizedEventHandler(runtime);
  const exit = createExitWebhookHandlers(runtime);

  type EventLoader = (
    stored: StoredEvent,
    provider: PaymentProvider,
    conn: Connection,
  ) => Promise<VerifiedEvent>;

  async function claimAndProcess(
    rowId: string,
    connectionId: string,
    load: EventLoader,
  ): Promise<WebhookEventOutcome> {
    const claim = await repo.claimEvent(rowId, runtime.now(), eventLeaseMs);
    if (claim.kind === "duplicate" || claim.kind === "missing") {
      return claim.kind === "duplicate" ? "duplicate" : "ignored";
    }
    if (claim.kind === "in_progress") {
      throw new WebhookEventBusyError();
    }
    const stored = claim.event;
    const connection = await repo.findConnectionById(connectionId);
    if (!connection) {
      await repo.finishEvent(stored.rowId, null, runtime.now());
      return "ignored";
    }
    const communityId = communityIdSchema.parse(connection.communityId);
    try {
      const provider = runtime.providers.get(connection.provider);
      const conn = connectionFor(runtime, connection);
      const event = await load(stored, provider, conn);
      if (isFeeAfterExit(event.type, connection, provider)) {
        await exit.refundFeeAfterExit({ connection, communityId, provider, conn }, event.object.id);
        await repo.finishEvent(stored.rowId, communityId, runtime.now());
        return "processed";
      }
      const events = await provider.normalizeEvent(event, conn);
      for (const normalized of events ?? []) {
        await handle({ connection, communityId, provider, conn }, normalized);
      }
      await repo.finishEvent(stored.rowId, communityId, runtime.now());
      return events ? "processed" : "ignored";
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "unknown";
      await repo.failEvent(stored.rowId, name);
      runtime.log({
        msg: `${webhookLabel(connection)} webhook processing failed`,
        level: "error",
        provider: connection.provider,
        eventId: stored.externalEventId,
        type: stored.type,
        error: name,
      });
      throw error;
    }
  }

  const fetchStoredEvent: EventLoader = async (stored, provider, conn) => {
    if (!provider.retrieveEvent) {
      throw new PaymentsUnavailableError(`${provider.displayName} event retrieval`);
    }
    const event = await provider.retrieveEvent(
      { eventId: stored.externalEventId, accountId: stored.externalAccountId },
      conn,
    );
    if (event.id !== stored.externalEventId || event.type !== stored.type) {
      throw new WebhookEventMismatchError();
    }
    return event;
  };

  function processWebhookEvent(payload: WebhookEventJobPayload): Promise<WebhookEventOutcome> {
    return claimAndProcess(payload.providerEventId, payload.connectionId, fetchStoredEvent);
  }

  async function processInline(
    rowId: string,
    connection: ConnectionRecord,
    event: VerifiedEvent,
  ): Promise<WebhookResult> {
    try {
      return result(200, await claimAndProcess(rowId, connection.id, async () => event));
    } catch (error: unknown) {
      return error instanceof WebhookEventBusyError
        ? result(409, "in_progress")
        : result(500, "failed");
    }
  }

  async function accept(
    event: VerifiedEvent,
    rawBody: string,
    connection: ConnectionRecord,
    expectLive: boolean,
  ): Promise<WebhookResult> {
    if (event.livemode !== expectLive) {
      return result(200, "ignored");
    }
    const recorded = await repo.recordEvent({
      provider: connection.provider,
      externalEventId: event.id,
      externalAccountId: event.account,
      connectionId: connection.id,
      type: event.type,
      livemode: event.livemode,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      now: runtime.now(),
    });
    if (recorded.processed) {
      return result(200, "duplicate");
    }
    const queueable = runtime.providers.get(connection.provider).retrieveEvent !== undefined;
    if (!runtime.jobs || !queueable) {
      return processInline(recorded.rowId, connection, event);
    }
    try {
      await runtime.jobs.scheduleWebhookEvent({
        providerEventId: recorded.rowId,
        connectionId: connection.id,
      });
      return result(200, "queued");
    } catch (error: unknown) {
      runtime.log({
        msg: `${webhookLabel(connection)} webhook could not be queued`,
        level: "error",
        provider: connection.provider,
        eventId: event.id,
        type: event.type,
        error: error instanceof Error ? error.name : "unknown",
      });
      return result(500, "failed");
    }
  }

  function webhookLabel(connection: ConnectionRecord): string {
    const provider = runtime.providers.find(connection.provider);
    return (provider?.displayName ?? connection.provider).toLowerCase();
  }

  function verify(
    provider: PaymentProvider,
    request: RawWebhook,
    conn: Connection | null,
  ): VerifiedEvent | null {
    try {
      return provider.verifyWebhook(request, conn);
    } catch (error: unknown) {
      if (error instanceof WebhookSignatureError || error instanceof z.ZodError) {
        return null;
      }
      throw error;
    }
  }

  function openConnectionFor(
    connection: ConnectionRecord,
  ): { kind: "ok"; conn: Connection } | { kind: "not_configured" } {
    if (!runtime.env.encryptionKeys) {
      return { kind: "not_configured" };
    }
    try {
      return { kind: "ok", conn: connectionFor(runtime, connection) };
    } catch (error: unknown) {
      if (error instanceof SecretDecryptionError) {
        return { kind: "not_configured" };
      }
      throw error;
    }
  }

  async function handleConnectionWebhook(
    setup: ConnectionWebhookSetup,
    connectionId: string,
    request: RawWebhook,
  ): Promise<WebhookResult> {
    if (!uuid.safeParse(connectionId).success) {
      return result(404, "unknown_connection");
    }
    const connection = await repo.findConnectionById(connectionId);
    const provider = connection ? runtime.providers.find(connection.provider) : null;
    if (
      !connection ||
      !provider ||
      provider.setup !== setup ||
      connection.status === "disconnected"
    ) {
      return result(404, "unknown_connection");
    }
    if (!connection.webhookSecretEncrypted || !connection.encryptedSecret) {
      return result(503, "not_configured");
    }
    const opened = openConnectionFor(connection);
    if (opened.kind !== "ok") {
      return result(503, "not_configured");
    }
    const event = verify(provider, request, opened.conn);
    if (!event) {
      return result(400, "invalid_signature");
    }
    if (setup === "access_token") {
      await repo.inCommunityAsSystem(communityIdSchema.parse(connection.communityId), (store) =>
        store.updateConnection(connection.id, { lastWebhookAt: runtime.now() }),
      );
    }
    return accept(event, request.rawBody, connection, provider.expectsLiveEvents(opened.conn));
  }

  async function handlePlatformWebhook(request: RawWebhook): Promise<WebhookResult> {
    const provider = providerWithSetup(runtime, "platform_account");
    const routing = provider.platformWebhooks;
    if (!routing?.isConfigured()) {
      return result(503, "not_configured");
    }
    const event = verify(provider, request, null);
    if (!event) {
      return result(400, "invalid_signature");
    }
    const account = routing.accountOf(event);
    const connection = account
      ? ((await repo.findConnectionByAccount(account)) ??
        (await repo.findExitedConnectionByAccount(account)))
      : null;
    if (!connection || connection.provider !== provider.id) {
      return result(200, "unknown_connection");
    }
    if (connection.status === "disconnected" && !routing.acceptsAfterDisconnect(event.type)) {
      return result(200, "ignored");
    }
    return accept(event, request.rawBody, connection, provider.expectsLiveEvents(null));
  }

  return {
    processWebhookEvent,

    handleWebhook(target, delivery) {
      const request = rawWebhook(delivery);
      return target.setup === "platform_account"
        ? handlePlatformWebhook(request)
        : handleConnectionWebhook(target.setup, target.connectionId, request);
    },
  };
}
