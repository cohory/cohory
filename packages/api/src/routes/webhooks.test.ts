import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema, newId } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import {
  WebhookEndpointDisabledError,
  WebhookEndpointNotFoundError,
  type WebhookEndpointView,
} from "@cohory/webhooks";
import { beforeEach, describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";
import { createWebhooksStub, type WebhooksStub } from "../test/webhooks-stub";

const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get("x-test-user");
  return userId ? { userId } : null;
};

let webhooks: WebhooksStub;
let api: ReturnType<typeof createApi>;
let communityId: string;
let owner: string;
const endpointId = newId();

const endpoint: WebhookEndpointView = {
  id: endpointId,
  url: "https://hooks.example.com/cohory",
  description: null,
  eventTypes: ["post.created"],
  status: "active",
  disabledReason: null,
  disabledAt: null,
  failingSince: null,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  previousSecretExpiresAt: null,
  createdAt: new Date("2026-10-19T10:00:00.000Z"),
};

beforeEach(() => {
  const repo = createFakeRepository();
  const community = repo.addCommunity({ slug: communitySlugSchema.parse("makers") });
  communityId = community.id;
  owner = newId();
  repo.addMembership({ communityId, userId: owner, role: "owner" });
  webhooks = createWebhooksStub();
  api = createApi(() =>
    apiDeps({
      resolveSession,
      communities: createCommunitiesService(repo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
          publicUrl: (key) => `/files/${key}`,
        },
      }),
      webhooks,
    }),
  );
});

function call(
  path: string,
  init: { method?: string; body?: unknown; userId?: string | null } = {},
) {
  const headers = new Headers();
  if (init.userId !== null) {
    headers.set("x-test-user", init.userId ?? owner);
  }
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return api.request(`/api/v1/communities/makers/manage/webhooks${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("webhook routes", () => {
  it("lists endpoints without secrets", async () => {
    webhooks.listEndpoints.mockResolvedValue([endpoint]);
    const response = await call("");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ ...endpoint, createdAt: "2026-10-19T10:00:00.000Z" }],
      nextCursor: null,
    });
    expect(webhooks.listEndpoints).toHaveBeenCalledWith(expect.anything(), communityId);
  });

  it("creates an endpoint and returns its secret once", async () => {
    webhooks.createEndpoint.mockResolvedValue({ endpoint, secret: "whsec_abc" });
    const body = { url: endpoint.url, eventTypes: ["post.created"] };
    const response = await call("", { method: "POST", body });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      secret: "whsec_abc",
      endpoint: { id: endpointId },
    });
    expect(webhooks.createEndpoint).toHaveBeenCalledWith(expect.anything(), communityId, body);
  });

  it("rejects an unknown event type before calling the service", async () => {
    const response = await call("", {
      method: "POST",
      body: { url: endpoint.url, eventTypes: ["like.added"] },
    });
    expect(response.status).toBe(422);
    expect(webhooks.createEndpoint).not.toHaveBeenCalled();
  });

  it("answers 401 to a signed out caller and 403 to a member", async () => {
    webhooks.listEndpoints.mockRejectedValueOnce(new UnauthenticatedError());
    expect((await call("", { userId: null })).status).toBe(401);
    webhooks.listEndpoints.mockRejectedValueOnce(new ForbiddenError("manage", "webhook"));
    expect((await call("")).status).toBe(403);
  });

  it("maps a missing endpoint to 404 and a disabled one to 409", async () => {
    webhooks.getEndpoint.mockRejectedValue(new WebhookEndpointNotFoundError());
    expect((await call(`/${endpointId}`)).status).toBe(404);
    webhooks.sendTestEvent.mockRejectedValue(new WebhookEndpointDisabledError());
    const response = await call(`/${endpointId}/test`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "endpoint_disabled" } });
  });

  it("queues a test event and pages the delivery log", async () => {
    const at = new Date("2026-10-19T10:05:00.000Z");
    const delivery = {
      id: newId(),
      eventId: "test_1",
      eventType: "webhook.test",
      status: "pending" as const,
      attempts: 0,
      responseStatus: null,
      lastError: null,
      lastAttemptAt: null,
      nextAttemptAt: at,
      createdAt: at,
    };
    webhooks.sendTestEvent.mockResolvedValue(delivery);
    expect((await call(`/${endpointId}/test`, { method: "POST" })).status).toBe(202);
    webhooks.listDeliveries.mockResolvedValue({ data: [delivery], nextCursor: "next" });
    const response = await call(`/${endpointId}/deliveries?limit=10&cursor=abc`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nextCursor: "next",
      data: [{ eventId: "test_1" }],
    });
    expect(webhooks.listDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      endpointId,
      {
        limit: 10,
        cursor: "abc",
      },
    );
  });

  it("rotates, disables, enables, and deletes", async () => {
    webhooks.rotateSecret.mockResolvedValue({ endpoint, secret: "whsec_new" });
    webhooks.disableEndpoint.mockResolvedValue({ ...endpoint, status: "disabled" });
    webhooks.enableEndpoint.mockResolvedValue(endpoint);
    webhooks.deleteEndpoint.mockResolvedValue(undefined);
    expect(
      await (await call(`/${endpointId}/rotate-secret`, { method: "POST" })).json(),
    ).toMatchObject({
      secret: "whsec_new",
    });
    expect((await call(`/${endpointId}/disable`, { method: "POST" })).status).toBe(200);
    expect((await call(`/${endpointId}/enable`, { method: "POST" })).status).toBe(200);
    expect((await call(`/${endpointId}`, { method: "DELETE" })).status).toBe(204);
    expect(webhooks.rotateSecret).toHaveBeenLastCalledWith(
      expect.anything(),
      communityId,
      endpointId,
      { keepPrevious: false },
    );
  });

  it("rolls the secret with a 24 hour overlap when asked", async () => {
    const until = new Date("2026-10-20T10:00:00.000Z");
    webhooks.rotateSecret.mockResolvedValue({
      endpoint: { ...endpoint, previousSecretExpiresAt: until },
      secret: "whsec_new",
    });
    const response = await call(`/${endpointId}/rotate-secret`, {
      method: "POST",
      body: { keepPrevious: true },
    });
    expect(await response.json()).toMatchObject({
      endpoint: { previousSecretExpiresAt: until.toISOString() },
    });
    expect(webhooks.rotateSecret).toHaveBeenLastCalledWith(
      expect.anything(),
      communityId,
      endpointId,
      { keepPrevious: true },
    );
  });

  it("opens a delivery with its attempts and resends it", async () => {
    const deliveryId = newId();
    const at = new Date("2026-10-19T10:05:00.000Z");
    const delivery = {
      id: deliveryId,
      eventId: "test_1",
      eventType: "webhook.test",
      status: "failed" as const,
      attempts: 1,
      responseStatus: 500,
      lastError: "http_500",
      lastAttemptAt: at,
      nextAttemptAt: null,
      createdAt: at,
    };
    webhooks.getDelivery.mockResolvedValue({
      delivery,
      payload: { type: "webhook.test", timestamp: at.toISOString(), data: { communityId } },
      attempts: [
        {
          at,
          requestHeaders: { "webhook-id": "test_1", "webhook-signature": "v1,abc" },
          requestBody: "{}",
          responseStatus: 500,
          responseBodyExcerpt: "down",
          errorCode: "http_500",
          durationMs: 12,
        },
      ],
    });
    const detail = await call(`/${endpointId}/deliveries/${deliveryId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      delivery: { id: deliveryId, lastAttemptAt: at.toISOString() },
      attempts: [{ at: at.toISOString(), responseBodyExcerpt: "down" }],
    });

    webhooks.resendDelivery.mockResolvedValue({ ...delivery, status: "pending", attempts: 0 });
    const resent = await call(`/${endpointId}/deliveries/${deliveryId}/resend`, {
      method: "POST",
    });
    expect(resent.status).toBe(202);
    expect(webhooks.resendDelivery).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      endpointId,
      deliveryId,
    );
  });

  it("resends failed deliveries since a time and refuses a bad time", async () => {
    webhooks.resendFailedDeliveries.mockResolvedValue({ resent: 3 });
    const since = "2026-10-19T09:00:00.000Z";
    const response = await call(`/${endpointId}/resend-failed`, {
      method: "POST",
      body: { since },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ resent: 3 });
    expect(webhooks.resendFailedDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      communityId,
      endpointId,
      { since },
    );
    const bad = await call(`/${endpointId}/resend-failed`, {
      method: "POST",
      body: { since: "yesterday" },
    });
    expect(bad.status).toBe(422);
  });

  it("answers 403 to a member who tries to resend or edit", async () => {
    const deliveryId = newId();
    webhooks.resendDelivery.mockRejectedValue(new ForbiddenError("manage", "webhook"));
    webhooks.updateEndpoint.mockRejectedValue(new ForbiddenError("manage", "webhook"));
    expect(
      (await call(`/${endpointId}/deliveries/${deliveryId}/resend`, { method: "POST" })).status,
    ).toBe(403);
    expect(
      (await call(`/${endpointId}`, { method: "PATCH", body: { description: "Mine" } })).status,
    ).toBe(403);
  });
});
