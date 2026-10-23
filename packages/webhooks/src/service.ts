import type { KeyInput } from "@cohory/payments/crypto";
import { assertCan, can, UnauthenticatedError, type Actor } from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { CommunityNotFoundError } from "@cohory/communities";
import {
  appendAuditEntry,
  communityIdSchema,
  findMembershipIn,
  getCommunityById,
  newId as defaultNewId,
  runInCommunity,
  setRlsFlag,
  withCommunity,
  type Database,
} from "@cohory/db";
import { webhookDeliveries, webhookEndpoints, type WebhookEndpoint } from "@cohory/db/schema";
import { isWebhookEventType, type WebhookEventType } from "@cohory/events";
import { asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createDeliveryOperations, type Managed, type ServiceCore } from "./deliveries";
import { sealWebhookSecret } from "./env";
import { WebhookEndpointLimitError, WebhookEndpointNotFoundError } from "./errors";
import type { DeliveryQueue } from "./queue";
import {
  createEndpointInputSchema,
  maxEndpointsPerCommunity,
  parseOrThrow,
  rotateSecretInputSchema,
  secretOverlapMs,
  updateEndpointInputSchema,
  type CreateEndpointInput,
  type RotateSecretInput,
  type UpdateEndpointInput,
} from "./schemas";
import { generateWebhookSecret } from "./signature";
import { toEndpointView, type CreatedWebhookEndpoint, type WebhookEndpointView } from "./views";

export interface WebhooksServiceDeps {
  readonly db: Database;
  readonly key: () => KeyInput;
  readonly queue: DeliveryQueue;
  readonly allowPrivateHosts?: readonly string[];
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newSecret?: () => string;
}

const uuid = z.uuid();

function eventTypesOf(row: WebhookEndpoint): WebhookEventType[] {
  return row.eventTypes.filter(isWebhookEventType);
}

export function createWebhooksService(deps: WebhooksServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;
  const newSecret = deps.newSecret ?? generateWebhookSecret;
  const allowPrivateHosts = deps.allowPrivateHosts ?? [];
  const createSchema = createEndpointInputSchema(allowPrivateHosts);
  const updateSchema = updateEndpointInputSchema(allowPrivateHosts);

  function view(row: WebhookEndpoint): WebhookEndpointView {
    return toEndpointView(row, eventTypesOf(row), now());
  }

  async function inManaged<T>(
    actor: Actor,
    communityId: string,
    fn: (managed: Managed) => Promise<T>,
  ): Promise<T> {
    if (actor.kind !== "user") {
      throw new UnauthenticatedError();
    }
    const parsed = communityIdSchema.safeParse(communityId);
    const community = parsed.success ? await getCommunityById(deps.db, parsed.data) : null;
    if (!community) {
      throw new CommunityNotFoundError();
    }
    return runInCommunity(withCommunity(deps.db, community.id), async (q) => {
      const member = await findMembershipIn(q, actor.userId);
      const role = member?.status === "active" ? member.role : null;
      const context = { role, communityPrivacy: community.privacy };
      if (!can(actor, "read", "community", context)) {
        throw new CommunityNotFoundError();
      }
      assertCan(actor, "manage", "webhook", context);
      await setRlsFlag(q.tx, "webhooks_manager");
      return fn({ q, community, userId: actor.userId });
    });
  }

  async function loadEndpoint({ q }: Managed, endpointId: string): Promise<WebhookEndpoint> {
    if (!uuid.safeParse(endpointId).success) {
      throw new WebhookEndpointNotFoundError();
    }
    const [row] = await q.tx
      .select()
      .from(webhookEndpoints)
      .where(q.where(webhookEndpoints, eq(webhookEndpoints.id, endpointId)))
      .limit(1)
      .for("update");
    if (!row) {
      throw new WebhookEndpointNotFoundError();
    }
    return row;
  }

  async function updateRow(
    { q }: Managed,
    endpointId: string,
    patch: Partial<typeof webhookEndpoints.$inferInsert>,
  ): Promise<WebhookEndpoint> {
    const [row] = await q.tx
      .update(webhookEndpoints)
      .set({ ...patch, updatedAt: now() })
      .where(q.where(webhookEndpoints, eq(webhookEndpoints.id, endpointId)))
      .returning();
    if (!row) {
      throw new WebhookEndpointNotFoundError();
    }
    return row;
  }

  async function failPending(managed: Managed, endpointId: string, at: Date): Promise<void> {
    await managed.q.tx
      .update(webhookDeliveries)
      .set({
        status: "failed",
        lastError: "endpoint_disabled",
        completedAt: at,
        lockedUntil: null,
        updatedAt: at,
      })
      .where(
        managed.q.where(
          webhookDeliveries,
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.status, "pending"),
        ),
      );
  }

  function audit(
    managed: Managed,
    action: string,
    target: string,
    metadata?: Record<string, unknown>,
  ) {
    return appendAuditEntry(managed.q, { actorId: managed.userId, action, target, metadata });
  }

  const core: ServiceCore = { now, newId, queue: deps.queue, inManaged, loadEndpoint, audit };

  return {
    listEndpoints(actor: Actor, communityId: string): Promise<WebhookEndpointView[]> {
      return inManaged(actor, communityId, async ({ q }) => {
        const rows = await q.tx
          .select()
          .from(webhookEndpoints)
          .where(q.where(webhookEndpoints))
          .orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id));
        return rows.map(view);
      });
    },

    getEndpoint(
      actor: Actor,
      communityId: string,
      endpointId: string,
    ): Promise<WebhookEndpointView> {
      return inManaged(actor, communityId, async (managed) =>
        view(await loadEndpoint(managed, endpointId)),
      );
    },

    async createEndpoint(
      actor: Actor,
      communityId: string,
      input: CreateEndpointInput,
    ): Promise<CreatedWebhookEndpoint> {
      const parsed = parseOrThrow(createSchema, input);
      return inManaged(actor, communityId, async (managed) => {
        assertCommunityWritable(managed.community);
        const { q } = managed;
        await q.tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`cohory.webhooks:${q.communityId}`}, 0))`,
        );
        const [existing] = await q.tx
          .select({ value: count() })
          .from(webhookEndpoints)
          .where(q.where(webhookEndpoints));
        if ((existing?.value ?? 0) >= maxEndpointsPerCommunity) {
          throw new WebhookEndpointLimitError(maxEndpointsPerCommunity);
        }
        const id = newId();
        const secret = newSecret();
        const at = now();
        const [row] = await q.tx
          .insert(webhookEndpoints)
          .values(
            q.values({
              id,
              url: parsed.url,
              description: parsed.description,
              eventTypes: parsed.eventTypes,
              secretCiphertext: sealWebhookSecret(secret, deps.key(), id),
              createdBy: managed.userId,
              createdAt: at,
              updatedAt: at,
            }),
          )
          .returning();
        if (!row) {
          throw new Error("webhook endpoint insert returned no row");
        }
        await audit(managed, "webhook.created", id, {
          host: new URL(parsed.url).host,
          eventTypes: parsed.eventTypes,
        });
        return { endpoint: view(row), secret };
      });
    },

    async updateEndpoint(
      actor: Actor,
      communityId: string,
      endpointId: string,
      input: UpdateEndpointInput,
    ): Promise<WebhookEndpointView> {
      const patch = parseOrThrow(updateSchema, input);
      return inManaged(actor, communityId, async (managed) => {
        assertCommunityWritable(managed.community);
        await loadEndpoint(managed, endpointId);
        const row = await updateRow(managed, endpointId, {
          ...(patch.url === undefined ? {} : { url: patch.url }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
          ...(patch.eventTypes === undefined ? {} : { eventTypes: patch.eventTypes }),
        });
        await audit(managed, "webhook.updated", endpointId, {
          fields: Object.keys(patch).filter(
            (key) => patch[key as keyof typeof patch] !== undefined,
          ),
        });
        return view(row);
      });
    },

    rotateSecret(
      actor: Actor,
      communityId: string,
      endpointId: string,
      input: RotateSecretInput = {},
    ): Promise<CreatedWebhookEndpoint> {
      const { keepPrevious = false } = parseOrThrow(rotateSecretInputSchema, input);
      return inManaged(actor, communityId, async (managed) => {
        assertCommunityWritable(managed.community);
        const current = await loadEndpoint(managed, endpointId);
        const secret = newSecret();
        const row = await updateRow(managed, endpointId, {
          secretCiphertext: sealWebhookSecret(secret, deps.key(), endpointId),
          previousSecretCiphertext: keepPrevious ? current.secretCiphertext : null,
          previousSecretExpiresAt: keepPrevious
            ? new Date(now().getTime() + secretOverlapMs)
            : null,
        });
        await audit(managed, "webhook.secret_rotated", endpointId, { keepPrevious });
        return { endpoint: view(row), secret };
      });
    },

    disableEndpoint(
      actor: Actor,
      communityId: string,
      endpointId: string,
    ): Promise<WebhookEndpointView> {
      return inManaged(actor, communityId, async (managed) => {
        const current = await loadEndpoint(managed, endpointId);
        if (current.status === "disabled") {
          return view(current);
        }
        const at = now();
        const row = await updateRow(managed, endpointId, {
          status: "disabled",
          disabledReason: "manual",
          disabledAt: at,
        });
        await failPending(managed, endpointId, at);
        await audit(managed, "webhook.disabled", endpointId);
        return view(row);
      });
    },

    enableEndpoint(
      actor: Actor,
      communityId: string,
      endpointId: string,
    ): Promise<WebhookEndpointView> {
      return inManaged(actor, communityId, async (managed) => {
        assertCommunityWritable(managed.community);
        const current = await loadEndpoint(managed, endpointId);
        if (current.status === "active") {
          return view(current);
        }
        const row = await updateRow(managed, endpointId, {
          status: "active",
          disabledReason: null,
          disabledAt: null,
          failingSince: null,
          consecutiveFailures: 0,
        });
        await audit(managed, "webhook.enabled", endpointId);
        return view(row);
      });
    },

    deleteEndpoint(actor: Actor, communityId: string, endpointId: string): Promise<void> {
      return inManaged(actor, communityId, async (managed) => {
        await loadEndpoint(managed, endpointId);
        await managed.q.tx
          .delete(webhookEndpoints)
          .where(managed.q.where(webhookEndpoints, eq(webhookEndpoints.id, endpointId)));
        await audit(managed, "webhook.deleted", endpointId);
      });
    },

    ...createDeliveryOperations(core),
  };
}

export type WebhooksService = ReturnType<typeof createWebhooksService>;
