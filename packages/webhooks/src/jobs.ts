import {
  communityIdSchema,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type Database,
  type Transaction,
} from "@cohory/db";
import {
  communities,
  memberships,
  users,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints,
  webhookResponseExcerptMaxLength,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@cohory/db/schema";
import type { KeyInput } from "@cohory/payments/crypto";
import { EgressBlockedError, EgressTimeoutError, type Egress } from "@cohory/egress";
import { communityEmailBrand, webhookEndpointDisabledEmail, type Mailer } from "@cohory/email";
import type { WebhookFanoutJobPayload } from "@cohory/events";
import { and, asc, count, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";

import { nextAttemptDelayMs } from "./backoff";
import { toWebhookPayload } from "./catalog";
import { openWebhookSecret } from "./env";
import type { DeliveryQueue } from "./queue";
import { webhookHeaders } from "./signature";

export const endpointConcurrency = 4;
export const busyRetryMs = 10_000;
export const sweepBatch = 500;

export interface WebhookJobsDeps {
  readonly db: Database;
  readonly key: () => KeyInput;
  readonly egress: Egress;
  readonly queue: DeliveryQueue;
  readonly mailer: Mailer;
  readonly appUrl: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly log?: (line: Record<string, unknown>) => void;
}

export type DeliverResult =
  | { readonly kind: "succeeded"; readonly status: number }
  | { readonly kind: "retry_scheduled"; readonly at: Date; readonly error: string }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "endpoint_disabled"; readonly error: string; readonly emailed: boolean }
  | { readonly kind: "busy"; readonly retryAt: Date }
  | {
      readonly kind: "skipped";
      readonly reason: "missing" | "done" | "not_due" | "in_flight" | "disabled";
    };

interface Claimed {
  readonly delivery: WebhookDelivery;
  readonly endpoint: WebhookEndpoint;
}

interface Outcome {
  readonly ok: boolean;
  readonly status: number | null;
  readonly error: string | null;
  readonly request: { readonly headers: Record<string, string>; readonly body: string };
  readonly excerpt: string | null;
  readonly durationMs: number | null;
}

function excerptOf(body: string): string | null {
  const text = body.replaceAll("\u0000", "").slice(0, webhookResponseExcerptMaxLength);
  return text === "" ? null : text;
}

function errorCode(error: unknown): string {
  if (error instanceof EgressBlockedError) {
    return error.reason === "private_address" ? "blocked_address" : `blocked_${error.reason}`;
  }
  if (error instanceof EgressTimeoutError) {
    return "timeout";
  }
  return "connection_failed";
}

export function createWebhookJobs(deps: WebhookJobsDeps) {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const lockMs = timeoutMs + 30_000;
  const log = deps.log ?? (() => undefined);

  function asJob<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await setRlsFlag(tx, "webhook_jobs");
      return fn(tx);
    });
  }

  async function lockEndpoint(
    tx: Transaction,
    endpointId: string,
  ): Promise<WebhookEndpoint | null> {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpointId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  async function claim(deliveryId: string, at: Date): Promise<Claimed | DeliverResult> {
    return asJob(async (tx) => {
      const [peek] = await tx
        .select({ endpointId: webhookDeliveries.endpointId })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId))
        .limit(1);
      if (!peek) {
        return { kind: "skipped", reason: "missing" };
      }
      const endpoint = await lockEndpoint(tx, peek.endpointId);
      const [delivery] = await tx
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId))
        .limit(1)
        .for("update");
      if (!endpoint || !delivery) {
        return { kind: "skipped", reason: "missing" };
      }
      if (delivery.status !== "pending") {
        return { kind: "skipped", reason: "done" };
      }
      if (endpoint.status !== "active") {
        await tx
          .update(webhookDeliveries)
          .set({ status: "failed", lastError: "endpoint_disabled", completedAt: at, updatedAt: at })
          .where(eq(webhookDeliveries.id, deliveryId));
        return { kind: "skipped", reason: "disabled" };
      }
      if (delivery.nextAttemptAt && delivery.nextAttemptAt > at) {
        return { kind: "skipped", reason: "not_due" };
      }
      if (delivery.lockedUntil && delivery.lockedUntil > at) {
        return { kind: "skipped", reason: "in_flight" };
      }
      const [inFlight] = await tx
        .select({ value: count() })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.endpointId, endpoint.id),
            eq(webhookDeliveries.status, "pending"),
            gt(webhookDeliveries.lockedUntil, at),
            ne(webhookDeliveries.id, deliveryId),
          ),
        );
      if ((inFlight?.value ?? 0) >= endpointConcurrency) {
        return { kind: "busy", retryAt: new Date(at.getTime() + busyRetryMs) };
      }
      await tx
        .update(webhookDeliveries)
        .set({ lockedUntil: new Date(at.getTime() + lockMs), updatedAt: at })
        .where(eq(webhookDeliveries.id, deliveryId));
      return { delivery, endpoint };
    });
  }

  function previousSecrets(endpoint: WebhookEndpoint, at: Date): string[] {
    const { previousSecretCiphertext: sealed, previousSecretExpiresAt: expires } = endpoint;
    if (!sealed || !expires || expires <= at) {
      return [];
    }
    try {
      return [openWebhookSecret(sealed, deps.key(), endpoint.id)];
    } catch {
      return [];
    }
  }

  async function send({ delivery, endpoint }: Claimed, at: Date): Promise<Outcome> {
    const body = JSON.stringify(delivery.payload);
    let headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "cohory-webhooks/1",
    };
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const secret = openWebhookSecret(endpoint.secretCiphertext, deps.key(), endpoint.id);
      headers = {
        ...headers,
        ...webhookHeaders(
          { secret, id: delivery.eventId, timestamp: Math.floor(at.getTime() / 1000), body },
          previousSecrets(endpoint, at),
        ),
      };
      const response = await deps.egress({ url: endpoint.url, method: "POST", headers, body });
      const ok = response.status >= 200 && response.status < 300;
      return {
        ok,
        status: response.status,
        error: ok ? null : `http_${response.status}`,
        request: { headers, body },
        excerpt: excerptOf(response.body),
        durationMs: elapsed(),
      };
    } catch (error: unknown) {
      const failed = { ok: false, status: null, request: { headers, body }, excerpt: null };
      if (error instanceof Error && error.name === "SecretDecryptionError") {
        return { ...failed, error: "secret_unreadable", durationMs: null };
      }
      return { ...failed, error: errorCode(error), durationMs: elapsed() };
    }
  }

  async function ownerContact(communityId: string) {
    const parsed = communityIdSchema.parse(communityId);
    return runInCommunity(withCommunity(deps.db, parsed), async ({ tx, where }) => {
      const [row] = await tx
        .select({
          email: users.email,
          communityName: communities.name,
          slug: communities.slug,
          appearance: communities.appearance,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(communities, eq(communities.id, memberships.communityId))
        .where(
          where(
            memberships,
            eq(memberships.role, "owner"),
            eq(memberships.status, "active"),
            eq(users.emailVerified, true),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async function notifyOwner(endpoint: WebhookEndpoint): Promise<boolean> {
    try {
      const owner = await ownerContact(endpoint.communityId);
      if (!owner) {
        return false;
      }
      await deps.mailer.send({
        to: owner.email,
        ...webhookEndpointDisabledEmail({
          communityName: owner.communityName,
          communityBrand: communityEmailBrand(owner.appearance),
          endpointHost: new URL(endpoint.url).host,
          url: new URL(`/c/${owner.slug}/manage/settings/webhooks`, deps.appUrl).toString(),
        }),
      });
      return true;
    } catch (error: unknown) {
      log({
        level: "warn",
        msg: "webhook disabled email failed",
        endpointId: endpoint.id,
        name: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  async function record(
    claimed: Claimed,
    outcome: Outcome,
    sentAt: Date,
    at: Date,
  ): Promise<DeliverResult & { disabledEndpoint?: WebhookEndpoint }> {
    return asJob(async (tx) => {
      const endpoint = await lockEndpoint(tx, claimed.endpoint.id);
      await tx.insert(webhookDeliveryAttempts).values({
        communityId: claimed.delivery.communityId,
        deliveryId: claimed.delivery.id,
        attemptedAt: sentAt,
        requestHeaders: outcome.request.headers,
        requestBody: outcome.request.body,
        responseStatus: outcome.status,
        responseBodyExcerpt: outcome.excerpt,
        errorCode: outcome.error,
        durationMs: outcome.durationMs,
      });
      const attempts = claimed.delivery.attempts + 1;
      const base = {
        attempts,
        lastAttemptAt: at,
        responseStatus: outcome.status,
        lockedUntil: null,
        updatedAt: at,
      };
      if (outcome.ok) {
        await tx
          .update(webhookDeliveries)
          .set({
            ...base,
            status: "succeeded",
            lastError: null,
            nextAttemptAt: null,
            completedAt: at,
          })
          .where(eq(webhookDeliveries.id, claimed.delivery.id));
        await tx
          .update(webhookEndpoints)
          .set({ consecutiveFailures: 0, failingSince: null, lastSuccessAt: at, updatedAt: at })
          .where(eq(webhookEndpoints.id, claimed.endpoint.id));
        return { kind: "succeeded", status: outcome.status ?? 0 };
      }
      const error = outcome.error ?? "unknown";
      await tx
        .update(webhookEndpoints)
        .set({
          consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
          failingSince: sql`coalesce(${webhookEndpoints.failingSince}, ${at.toISOString()}::timestamptz)`,
          updatedAt: at,
        })
        .where(eq(webhookEndpoints.id, claimed.endpoint.id));
      const delay = nextAttemptDelayMs(attempts);
      if (delay !== null) {
        const next = new Date(at.getTime() + delay);
        await tx
          .update(webhookDeliveries)
          .set({ ...base, lastError: error, nextAttemptAt: next })
          .where(eq(webhookDeliveries.id, claimed.delivery.id));
        return { kind: "retry_scheduled", at: next, error };
      }
      await tx
        .update(webhookDeliveries)
        .set({ ...base, status: "failed", lastError: error, nextAttemptAt: null, completedAt: at })
        .where(eq(webhookDeliveries.id, claimed.delivery.id));
      const neverRecovered =
        !endpoint?.lastSuccessAt || endpoint.lastSuccessAt < claimed.delivery.createdAt;
      if (!endpoint || endpoint.status !== "active" || !neverRecovered) {
        return { kind: "failed", error };
      }
      const [disabled] = await tx
        .update(webhookEndpoints)
        .set({ status: "disabled", disabledReason: "failures", disabledAt: at, updatedAt: at })
        .where(eq(webhookEndpoints.id, endpoint.id))
        .returning();
      await tx
        .update(webhookDeliveries)
        .set({
          status: "failed",
          lastError: "endpoint_disabled",
          completedAt: at,
          lockedUntil: null,
          updatedAt: at,
        })
        .where(
          and(
            eq(webhookDeliveries.endpointId, endpoint.id),
            eq(webhookDeliveries.status, "pending"),
          ),
        );
      return { kind: "failed", error, ...(disabled ? { disabledEndpoint: disabled } : {}) };
    });
  }

  return {
    async fanout(payload: WebhookFanoutJobPayload): Promise<{ readonly created: number }> {
      const at = now();
      const created = await asJob(async (tx) => {
        const types = [...new Set(payload.events.map((event) => event.type))];
        const endpoints = await tx
          .select({ id: webhookEndpoints.id, eventTypes: webhookEndpoints.eventTypes })
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.communityId, payload.communityId),
              eq(webhookEndpoints.status, "active"),
              sql`${webhookEndpoints.eventTypes} && ${sql.param(types)}::text[]`,
            ),
          );
        const rows = endpoints.flatMap((endpoint) =>
          payload.events.flatMap((event, index) =>
            endpoint.eventTypes.includes(event.type)
              ? [
                  {
                    communityId: payload.communityId,
                    endpointId: endpoint.id,
                    eventId: `evt_${payload.outboxId.replaceAll("-", "")}_${index}`,
                    eventType: event.type,
                    payload: toWebhookPayload(event, at),
                    nextAttemptAt: at,
                    createdAt: at,
                    updatedAt: at,
                  },
                ]
              : [],
          ),
        );
        if (rows.length === 0) {
          return [];
        }
        return tx
          .insert(webhookDeliveries)
          .values(rows)
          .onConflictDoNothing({
            target: [webhookDeliveries.endpointId, webhookDeliveries.eventId],
          })
          .returning({ id: webhookDeliveries.id });
      });
      for (const { id } of created) {
        await deps.queue.enqueue(id);
      }
      return { created: created.length };
    },

    async deliver(deliveryId: string): Promise<DeliverResult> {
      const at = now();
      const claimed = await claim(deliveryId, at);
      if ("kind" in claimed) {
        if (claimed.kind === "busy") {
          await deps.queue.enqueue(deliveryId, { startAfter: claimed.retryAt });
        }
        return claimed;
      }
      const outcome = await send(claimed, at);
      const result = await record(claimed, outcome, at, now());
      if (result.kind === "retry_scheduled") {
        await deps.queue.enqueue(deliveryId, { startAfter: result.at });
      }
      if (result.kind === "failed" && result.disabledEndpoint) {
        const emailed = await notifyOwner(result.disabledEndpoint);
        return { kind: "endpoint_disabled", error: result.error, emailed };
      }
      if (result.kind === "failed") {
        return { kind: "failed", error: result.error };
      }
      return result;
    },

    async sweep(): Promise<{ readonly enqueued: number }> {
      const at = now();
      const due = await asJob((tx) =>
        tx
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.status, "pending"),
              lte(webhookDeliveries.nextAttemptAt, at),
              or(isNull(webhookDeliveries.lockedUntil), lte(webhookDeliveries.lockedUntil, at)),
            ),
          )
          .orderBy(asc(webhookDeliveries.nextAttemptAt))
          .limit(sweepBatch),
      );
      for (const { id } of due) {
        await deps.queue.enqueue(id);
      }
      return { enqueued: due.length };
    },
  };
}

export type WebhookJobs = ReturnType<typeof createWebhookJobs>;
