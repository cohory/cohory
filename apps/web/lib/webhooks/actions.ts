"use server";

import { CommunitiesError } from "@cohory/communities";
import {
  getWebhooksService,
  WebhookDeliveryNotFoundError,
  WebhookEndpointDisabledError,
  WebhookEndpointLimitError,
  WebhookEndpointNotFoundError,
} from "@cohory/webhooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { manageActionFailure } from "../manage/errors";
import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import {
  toDeliveryDetailRow,
  toDeliveryRow,
  toEndpointRow,
  webhookEventNames,
  type DeliveryDetailRow,
  type DeliveryRow,
  type EndpointRow,
} from "./views";

const slugSchema = z.string().min(1).max(64);
const endpointIdSchema = z.uuid();

const fieldsSchema = z.object({
  url: z.string().trim().min(1, "Enter the URL of your receiver.").max(2048),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.enum(webhookEventNames)).min(1, "Choose at least one event."),
});

const createSchema = fieldsSchema.extend({ slug: slugSchema });

const endpointSchema = z.object({ slug: slugSchema, endpointId: endpointIdSchema });

const updateSchema = fieldsSchema.extend(endpointSchema.shape);

const rotateSchema = endpointSchema.extend({ keepPrevious: z.boolean() });

const deliverySchema = endpointSchema.extend({ deliveryId: z.uuid() });

const resendFailedSchema = endpointSchema.extend({ since: z.iso.datetime({ offset: true }) });

const actionSchema = endpointSchema.extend({
  action: z.enum(["disable", "enable", "delete", "test"]),
});

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof WebhookDeliveryNotFoundError) {
      return failure("This delivery no longer exists. Refresh the page.");
    }
    if (error instanceof WebhookEndpointNotFoundError) {
      return failure("This endpoint no longer exists. Refresh the page.");
    }
    if (error instanceof WebhookEndpointLimitError) {
      return failure(`A community can have up to ${error.limit} endpoints. Delete one first.`);
    }
    if (error instanceof WebhookEndpointDisabledError) {
      return failure("Turn the endpoint on first.");
    }
    const result = manageActionFailure(error);
    if (result) return result;
    if (error instanceof CommunitiesError) return failure("We couldn't find that community.");
    throw error;
  }
}

function webhooksPath(slug: string): string {
  return `/c/${slug}/manage/settings/webhooks`;
}

export interface CreatedEndpoint {
  readonly endpoint: EndpointRow;
  readonly secret: string;
}

export interface EndpointFields {
  url: string;
  description?: string;
  eventTypes: string[];
}

export async function createWebhookEndpointAction(
  raw: EndpointFields & { slug: string },
): Promise<ActionResult<CreatedEndpoint>> {
  return guard(async () => {
    const input = createSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const created = await getWebhooksService().createEndpoint(
      context.access.actor,
      context.communityId,
      { url: input.url, description: input.description ?? null, eventTypes: input.eventTypes },
    );
    revalidatePath(webhooksPath(context.slug));
    return { endpoint: toEndpointRow(created.endpoint), secret: created.secret };
  });
}

export async function updateWebhookEndpointAction(
  raw: EndpointFields & { slug: string; endpointId: string },
): Promise<ActionResult<EndpointRow>> {
  return guard(async () => {
    const input = updateSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const updated = await getWebhooksService().updateEndpoint(
      context.access.actor,
      context.communityId,
      input.endpointId,
      { url: input.url, description: input.description ?? null, eventTypes: input.eventTypes },
    );
    revalidatePath(webhooksPath(context.slug));
    return toEndpointRow(updated);
  });
}

export async function rotateWebhookSecretAction(raw: {
  slug: string;
  endpointId: string;
  keepPrevious: boolean;
}): Promise<ActionResult<CreatedEndpoint>> {
  return guard(async () => {
    const input = rotateSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const rotated = await getWebhooksService().rotateSecret(
      context.access.actor,
      context.communityId,
      input.endpointId,
      { keepPrevious: input.keepPrevious },
    );
    return { endpoint: toEndpointRow(rotated.endpoint), secret: rotated.secret };
  });
}

export async function webhookEndpointAction(raw: {
  slug: string;
  endpointId: string;
  action: "disable" | "enable" | "delete" | "test";
}): Promise<ActionResult<{ readonly delivery: DeliveryRow | null }>> {
  return guard(async () => {
    const input = actionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const service = getWebhooksService();
    const { actor } = context.access;
    let delivery: DeliveryRow | null = null;
    switch (input.action) {
      case "disable":
        await service.disableEndpoint(actor, context.communityId, input.endpointId);
        break;
      case "enable":
        await service.enableEndpoint(actor, context.communityId, input.endpointId);
        break;
      case "delete":
        await service.deleteEndpoint(actor, context.communityId, input.endpointId);
        break;
      case "test":
        delivery = toDeliveryRow(
          await service.sendTestEvent(actor, context.communityId, input.endpointId),
        );
        break;
    }
    revalidatePath(webhooksPath(context.slug));
    return { delivery };
  });
}

export async function listWebhookDeliveriesAction(raw: {
  slug: string;
  endpointId: string;
  cursor?: string;
}): Promise<ActionResult<{ readonly rows: DeliveryRow[]; readonly nextCursor: string | null }>> {
  return guard(async () => {
    const input = endpointSchema.extend({ cursor: z.string().max(512).optional() }).parse(raw);
    const context = await resolveCommunity(input.slug);
    const page = await getWebhooksService().listDeliveries(
      context.access.actor,
      context.communityId,
      input.endpointId,
      { cursor: input.cursor },
    );
    return { rows: page.data.map(toDeliveryRow), nextCursor: page.nextCursor };
  });
}

export async function getWebhookDeliveryAction(raw: {
  slug: string;
  endpointId: string;
  deliveryId: string;
}): Promise<ActionResult<DeliveryDetailRow>> {
  return guard(async () => {
    const input = deliverySchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const detail = await getWebhooksService().getDelivery(
      context.access.actor,
      context.communityId,
      input.endpointId,
      input.deliveryId,
    );
    return toDeliveryDetailRow(detail);
  });
}

export async function resendWebhookDeliveryAction(raw: {
  slug: string;
  endpointId: string;
  deliveryId: string;
}): Promise<ActionResult<DeliveryRow>> {
  return guard(async () => {
    const input = deliverySchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const delivery = await getWebhooksService().resendDelivery(
      context.access.actor,
      context.communityId,
      input.endpointId,
      input.deliveryId,
    );
    return toDeliveryRow(delivery);
  });
}

export async function resendFailedWebhookDeliveriesAction(raw: {
  slug: string;
  endpointId: string;
  since: string;
}): Promise<ActionResult<{ readonly resent: number }>> {
  return guard(async () => {
    const input = resendFailedSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const result = await getWebhooksService().resendFailedDeliveries(
      context.access.actor,
      context.communityId,
      input.endpointId,
      { since: input.since },
    );
    revalidatePath(webhooksPath(context.slug));
    return result;
  });
}
