import type { Actor } from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { CommunityValidationError } from "@cohory/communities";
import type { Community, ScopedQueries } from "@cohory/db";
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@cohory/db/schema";
import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { testEventType, testWebhookPayload } from "./catalog";
import { decodeDeliveryCursor, encodeDeliveryCursor } from "./cursor";
import { WebhookDeliveryNotFoundError, WebhookEndpointDisabledError } from "./errors";
import type { DeliveryQueue } from "./queue";
import {
  attemptsShown,
  deliveriesPageSize,
  listDeliveriesInputSchema,
  maxResendBatch,
  parseOrThrow,
  resendFailedInputSchema,
  type ListDeliveriesInput,
  type ResendFailedInput,
} from "./schemas";
import {
  toAttemptView,
  toDeliveryView,
  type WebhookDeliveryDetail,
  type WebhookDeliveryPage,
  type WebhookDeliveryView,
} from "./views";

export interface Managed {
  readonly q: ScopedQueries;
  readonly community: Community;
  readonly userId: string;
}

export interface ServiceCore {
  readonly now: () => Date;
  readonly newId: () => string;
  readonly queue: DeliveryQueue;
  inManaged<T>(actor: Actor, communityId: string, fn: (managed: Managed) => Promise<T>): Promise<T>;
  loadEndpoint(managed: Managed, endpointId: string): Promise<WebhookEndpoint>;
  audit(
    managed: Managed,
    action: string,
    target: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown>;
}

const uuid = z.uuid();

async function loadDelivery(
  { q }: Managed,
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDelivery> {
  if (!uuid.safeParse(deliveryId).success) {
    throw new WebhookDeliveryNotFoundError();
  }
  const [row] = await q.tx
    .select()
    .from(webhookDeliveries)
    .where(
      q.where(
        webhookDeliveries,
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.endpointId, endpointId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) {
    throw new WebhookDeliveryNotFoundError();
  }
  return row;
}

async function activeEndpoint(
  core: ServiceCore,
  managed: Managed,
  endpointId: string,
): Promise<WebhookEndpoint> {
  assertCommunityWritable(managed.community);
  const endpoint = await core.loadEndpoint(managed, endpointId);
  if (endpoint.status !== "active") {
    throw new WebhookEndpointDisabledError();
  }
  return endpoint;
}

function resetForResend(at: Date) {
  return {
    status: "pending" as const,
    attempts: 0,
    nextAttemptAt: at,
    lockedUntil: null,
    lastError: null,
    responseStatus: null,
    completedAt: null,
    updatedAt: at,
  };
}

export function createDeliveryOperations(core: ServiceCore) {
  return {
    async sendTestEvent(
      actor: Actor,
      communityId: string,
      endpointId: string,
    ): Promise<WebhookDeliveryView> {
      const delivery = await core.inManaged(actor, communityId, async (managed) => {
        await activeEndpoint(core, managed, endpointId);
        const at = core.now();
        const [row] = await managed.q.tx
          .insert(webhookDeliveries)
          .values(
            managed.q.values({
              endpointId,
              eventId: `test_${core.newId()}`,
              eventType: testEventType,
              payload: testWebhookPayload(managed.q.communityId, endpointId, at),
              nextAttemptAt: at,
              createdAt: at,
              updatedAt: at,
            }),
          )
          .returning();
        if (!row) {
          throw new Error("webhook delivery insert returned no row");
        }
        await core.audit(managed, "webhook.test_sent", endpointId);
        return row;
      });
      await core.queue.enqueue(delivery.id);
      return toDeliveryView(delivery);
    },

    async listDeliveries(
      actor: Actor,
      communityId: string,
      endpointId: string,
      input: ListDeliveriesInput = {},
    ): Promise<WebhookDeliveryPage> {
      const parsed = parseOrThrow(listDeliveriesInputSchema, input);
      const cursor = parsed.cursor ? decodeDeliveryCursor(parsed.cursor) : null;
      if (parsed.cursor && !cursor) {
        throw new CommunityValidationError([
          { path: "cursor", message: "The cursor is not valid." },
        ]);
      }
      const limit = parsed.limit ?? deliveriesPageSize;
      return core.inManaged(actor, communityId, async (managed) => {
        await core.loadEndpoint(managed, endpointId);
        const { q } = managed;
        const rows = await q.tx
          .select()
          .from(webhookDeliveries)
          .where(
            q.where(
              webhookDeliveries,
              eq(webhookDeliveries.endpointId, endpointId),
              cursor
                ? sql`(${webhookDeliveries.createdAt}, ${webhookDeliveries.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          data: page.map(toDeliveryView),
          nextCursor:
            rows.length > limit && last
              ? encodeDeliveryCursor({ at: last.createdAt, id: last.id })
              : null,
        };
      });
    },

    getDelivery(
      actor: Actor,
      communityId: string,
      endpointId: string,
      deliveryId: string,
    ): Promise<WebhookDeliveryDetail> {
      return core.inManaged(actor, communityId, async (managed) => {
        await core.loadEndpoint(managed, endpointId);
        const delivery = await loadDelivery(managed, endpointId, deliveryId);
        const { q } = managed;
        const attempts = await q.tx
          .select()
          .from(webhookDeliveryAttempts)
          .where(
            q.where(webhookDeliveryAttempts, eq(webhookDeliveryAttempts.deliveryId, delivery.id)),
          )
          .orderBy(desc(webhookDeliveryAttempts.attemptedAt))
          .limit(attemptsShown);
        return {
          delivery: toDeliveryView(delivery),
          payload: delivery.payload,
          attempts: attempts.map(toAttemptView),
        };
      });
    },

    async resendDelivery(
      actor: Actor,
      communityId: string,
      endpointId: string,
      deliveryId: string,
    ): Promise<WebhookDeliveryView> {
      const at = core.now();
      const { row, enqueue } = await core.inManaged(actor, communityId, async (managed) => {
        await activeEndpoint(core, managed, endpointId);
        const delivery = await loadDelivery(managed, endpointId, deliveryId);
        if (delivery.status === "pending" && delivery.lockedUntil && delivery.lockedUntil > at) {
          return { row: delivery, enqueue: false };
        }
        const patch =
          delivery.status === "pending" ? { nextAttemptAt: at, updatedAt: at } : resetForResend(at);
        const [updated] = await managed.q.tx
          .update(webhookDeliveries)
          .set(patch)
          .where(managed.q.where(webhookDeliveries, eq(webhookDeliveries.id, delivery.id)))
          .returning();
        if (!updated) {
          throw new WebhookDeliveryNotFoundError();
        }
        await core.audit(managed, "webhook.delivery_resent", endpointId, {
          deliveryId: delivery.id,
          eventType: delivery.eventType,
        });
        return { row: updated, enqueue: true };
      });
      if (enqueue) {
        await core.queue.enqueue(row.id, { startAfter: at });
      }
      return toDeliveryView(row);
    },

    async resendFailedDeliveries(
      actor: Actor,
      communityId: string,
      endpointId: string,
      input: ResendFailedInput,
    ): Promise<{ readonly resent: number }> {
      const { since } = parseOrThrow(resendFailedInputSchema, input);
      const at = core.now();
      const ids = await core.inManaged(actor, communityId, async (managed) => {
        await activeEndpoint(core, managed, endpointId);
        const { q } = managed;
        const failed = q.tx
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(
            q.where(
              webhookDeliveries,
              eq(webhookDeliveries.endpointId, endpointId),
              eq(webhookDeliveries.status, "failed"),
              gte(webhookDeliveries.createdAt, since),
            ),
          )
          .orderBy(webhookDeliveries.createdAt)
          .limit(maxResendBatch);
        const updated = await q.tx
          .update(webhookDeliveries)
          .set(resetForResend(at))
          .where(q.where(webhookDeliveries, inArray(webhookDeliveries.id, failed)))
          .returning({ id: webhookDeliveries.id });
        await core.audit(managed, "webhook.deliveries_resent", endpointId, {
          since: since.toISOString(),
          count: updated.length,
        });
        return updated.map((row) => row.id);
      });
      for (const id of ids) {
        await core.queue.enqueue(id, { startAfter: at });
      }
      return { resent: ids.length };
    },
  };
}
