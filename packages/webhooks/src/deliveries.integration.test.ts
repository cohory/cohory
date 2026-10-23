import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { ForbiddenError } from "@cohory/authz";
import { CommunityNotFoundError } from "@cohory/communities";
import type { Database } from "@cohory/db";
import { auditLog, webhookDeliveries, webhookDeliveryAttempts } from "@cohory/db/schema";
import { createEgress } from "@cohory/egress";
import type { Mailer } from "@cohory/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  WebhookDeliveryNotFoundError,
  WebhookEndpointDisabledError,
  WebhookEndpointNotFoundError,
} from "./errors";
import { createWebhookJobs } from "./jobs";
import { createWebhooksService } from "./service";
import { verifyWebhook } from "./signature";
import {
  actor,
  ensureProbeRole,
  fakeQueue,
  openDb,
  probeRole,
  seedCommunity,
  testKey,
  type Community,
} from "./test/fixtures";

interface Received {
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
  readonly path: string;
}

const hour = 60 * 60 * 1000;
const admin = openDb();
let probe: { db: Database; close: () => Promise<void> };
let server: Server;
let base: string;
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const received: Received[] = [];
let community: Community;
let other: Community;
let clock = new Date("2026-10-20T10:00:00.000Z");
const mailer: Mailer = { send: async () => undefined };
let queue = fakeQueue();

function jobs() {
  return createWebhookJobs({
    db: probe.db,
    key: () => testKey,
    egress: createEgress({ allowPrivateHosts: ["127.0.0.1"], timeoutMs: 2000 }),
    queue,
    mailer,
    appUrl: "https://cohory.test",
    timeoutMs: 2000,
    now: () => clock,
  });
}

function service() {
  return createWebhooksService({
    db: probe.db,
    key: () => testKey,
    queue,
    allowPrivateHosts: ["127.0.0.1"],
    now: () => clock,
  });
}

const owner = () => actor(community.members.owner);

async function endpoint(path: string) {
  return service().createEndpoint(owner(), community.id, {
    url: `${base}${path}`,
    eventTypes: ["post.created"],
  });
}

function lastRequest(path: string): Received {
  const request = received.findLast((entry) => entry.path === path);
  if (!request) throw new Error(`no request to ${path}`);
  return request;
}

function signedHeaders(request: Received) {
  return {
    "webhook-id": String(request.headers["webhook-id"]),
    "webhook-timestamp": String(request.headers["webhook-timestamp"]),
    "webhook-signature": String(request.headers["webhook-signature"]),
  };
}

beforeAll(async () => {
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  community = await seedCommunity(admin.db, "hooks-detail");
  other = await seedCommunity(admin.db, "hooks-other");
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body, path: req.url ?? "" });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await probe.close();
  await admin.close();
});

beforeEach(() => {
  queue = fakeQueue();
  respond = (_req, res) => {
    res.writeHead(204);
    res.end();
  };
  clock = new Date("2026-10-20T10:00:00.000Z");
});

describe("delivery detail", () => {
  it("records each attempt with the request and a short response excerpt, never the secret", async () => {
    respond = (_req, res) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`broken\u0000${"x".repeat(3000)}`);
    };
    const { endpoint: target, secret } = await endpoint("/detail");
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await jobs().deliver(test.id);
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    };
    clock = new Date(clock.getTime() + 5_000);
    await jobs().deliver(test.id);

    const detail = await service().getDelivery(owner(), community.id, target.id, test.id);
    expect(detail.delivery).toMatchObject({ id: test.id, status: "succeeded", attempts: 2 });
    expect(detail.payload).toMatchObject({ type: "webhook.test" });
    expect(detail.attempts).toHaveLength(2);
    const [latest, first] = detail.attempts;
    expect(latest).toMatchObject({
      at: clock,
      responseStatus: 200,
      responseBodyExcerpt: '{"ok":true}',
      errorCode: null,
    });
    expect(first).toMatchObject({ responseStatus: 500, errorCode: "http_500" });
    expect(first?.responseBodyExcerpt).toHaveLength(2048);
    expect(first?.responseBodyExcerpt?.startsWith("broken")).toBe(true);
    expect(latest?.requestBody).toBe(lastRequest("/detail").body);
    expect(latest?.requestHeaders).toMatchObject({
      "content-type": "application/json",
      "webhook-id": test.eventId,
      "webhook-signature": signedHeaders(lastRequest("/detail"))["webhook-signature"],
    });
    expect(JSON.stringify(detail)).not.toContain(secret);
    expect(JSON.stringify(detail)).not.toContain(secret.slice(6));
  });

  it("does not show a delivery through another endpoint", async () => {
    const { endpoint: first } = await endpoint("/a");
    const { endpoint: second } = await endpoint("/b");
    const test = await service().sendTestEvent(owner(), community.id, first.id);
    await expect(
      service().getDelivery(owner(), community.id, second.id, test.id),
    ).rejects.toBeInstanceOf(WebhookDeliveryNotFoundError);
    await expect(
      service().getDelivery(owner(), community.id, first.id, "not-a-uuid"),
    ).rejects.toBeInstanceOf(WebhookDeliveryNotFoundError);
  });
});

describe("resend", () => {
  it("sends a failed delivery again with the same webhook id and a fresh retry schedule", async () => {
    const { endpoint: target } = await endpoint("/resend");
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await service().disableEndpoint(owner(), community.id, target.id);
    await service().enableEndpoint(owner(), community.id, target.id);
    queue = fakeQueue();

    const resent = await service().resendDelivery(owner(), community.id, target.id, test.id);
    expect(resent).toMatchObject({ id: test.id, status: "pending", attempts: 0, lastError: null });
    expect(queue.enqueue).toHaveBeenCalledWith(test.id, { startAfter: clock });
    expect(await jobs().deliver(test.id)).toEqual({ kind: "succeeded", status: 204 });
    expect(lastRequest("/resend").headers["webhook-id"]).toBe(test.eventId);
    const audits = await admin.db.select().from(auditLog).where(eq(auditLog.target, target.id));
    expect(audits.map((entry) => entry.action)).toContain("webhook.delivery_resent");
  });

  it("sends a waiting delivery now instead of at its next retry", async () => {
    const { endpoint: target } = await endpoint("/now");
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await admin.db
      .update(webhookDeliveries)
      .set({ attempts: 2, nextAttemptAt: new Date(clock.getTime() + 2 * hour) })
      .where(eq(webhookDeliveries.id, test.id));
    const resent = await service().resendDelivery(owner(), community.id, target.id, test.id);
    expect(resent).toMatchObject({ status: "pending", attempts: 2, nextAttemptAt: clock });
    expect(await jobs().deliver(test.id)).toEqual({ kind: "succeeded", status: 204 });
  });

  it("refuses to resend while the endpoint is off", async () => {
    const { endpoint: target } = await endpoint("/off");
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await service().disableEndpoint(owner(), community.id, target.id);
    await expect(
      service().resendDelivery(owner(), community.id, target.id, test.id),
    ).rejects.toBeInstanceOf(WebhookEndpointDisabledError);
  });

  it("resends every failed delivery since a time, and leaves older ones alone", async () => {
    const { endpoint: target } = await endpoint("/since");
    const old = await service().sendTestEvent(owner(), community.id, target.id);
    clock = new Date(clock.getTime() + hour);
    const since = clock;
    const missed = [
      await service().sendTestEvent(owner(), community.id, target.id),
      await service().sendTestEvent(owner(), community.id, target.id),
    ];
    await service().disableEndpoint(owner(), community.id, target.id);
    await service().enableEndpoint(owner(), community.id, target.id);
    queue = fakeQueue();

    const result = await service().resendFailedDeliveries(owner(), community.id, target.id, {
      since: since.toISOString(),
    });
    expect(result).toEqual({ resent: 2 });
    expect(queue.enqueue.mock.calls.map(([id]) => id).sort()).toEqual(
      missed.map((delivery) => delivery.id).sort(),
    );
    const [oldRow] = await admin.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, old.id));
    expect(oldRow?.status).toBe("failed");
  });
});

describe("rolling the secret", () => {
  it("keeps the old secret for 24 hours, signs with both, then only with the new one", async () => {
    const { endpoint: target, secret: oldSecret } = await endpoint("/roll");
    const rolled = await service().rotateSecret(owner(), community.id, target.id, {
      keepPrevious: true,
    });
    expect(rolled.endpoint.previousSecretExpiresAt).toEqual(new Date(clock.getTime() + 24 * hour));

    const during = await service().sendTestEvent(owner(), community.id, target.id);
    await jobs().deliver(during.id);
    const request = lastRequest("/roll");
    for (const secret of [oldSecret, rolled.secret]) {
      expect(() =>
        verifyWebhook({ secret, body: request.body, headers: signedHeaders(request), now: clock }),
      ).not.toThrow();
    }

    clock = new Date(clock.getTime() + 24 * hour + 1000);
    const [after] = await service()
      .listEndpoints(owner(), community.id)
      .then((all) => all.filter((entry) => entry.id === target.id));
    expect(after?.previousSecretExpiresAt).toBeNull();
    const later = await service().sendTestEvent(owner(), community.id, target.id);
    await jobs().deliver(later.id);
    const laterRequest = lastRequest("/roll");
    expect(String(laterRequest.headers["webhook-signature"]).split(" ")).toHaveLength(1);
    expect(() =>
      verifyWebhook({
        secret: rolled.secret,
        body: laterRequest.body,
        headers: signedHeaders(laterRequest),
        now: clock,
      }),
    ).not.toThrow();
  });

  it("drops the old secret at once when asked to", async () => {
    const { endpoint: target } = await endpoint("/roll-now");
    await service().rotateSecret(owner(), community.id, target.id, { keepPrevious: true });
    const rolled = await service().rotateSecret(owner(), community.id, target.id);
    expect(rolled.endpoint.previousSecretExpiresAt).toBeNull();
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await jobs().deliver(test.id);
    expect(String(lastRequest("/roll-now").headers["webhook-signature"]).split(" ")).toHaveLength(
      1,
    );
  });
});

describe("permissions", () => {
  it.each(["moderator", "member"] as const)(
    "refuses a %s to open, resend, or edit",
    async (role) => {
      const { endpoint: target } = await endpoint(`/perm-${role}`);
      const test = await service().sendTestEvent(owner(), community.id, target.id);
      const caller = actor(community.members[role]);
      await expect(
        service().getDelivery(caller, community.id, target.id, test.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service().resendDelivery(caller, community.id, target.id, test.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service().resendFailedDeliveries(caller, community.id, target.id, {
          since: clock.toISOString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service().updateEndpoint(caller, community.id, target.id, { description: "Mine" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it("lets an admin edit an endpoint in place and resend", async () => {
    const { endpoint: target } = await endpoint("/perm-admin");
    const caller = actor(community.members.admin);
    const updated = await service().updateEndpoint(caller, community.id, target.id, {
      url: `${base}/perm-admin-2`,
      description: "Zapier",
      eventTypes: ["post.created", "member.joined"],
    });
    expect(updated).toMatchObject({
      id: target.id,
      url: `${base}/perm-admin-2`,
      description: "Zapier",
      eventTypes: ["member.joined", "post.created"],
    });
    const test = await service().sendTestEvent(caller, community.id, target.id);
    await jobs().deliver(test.id);
    expect(lastRequest("/perm-admin-2").headers["webhook-id"]).toBe(test.eventId);
    await expect(
      service().resendDelivery(caller, community.id, target.id, test.id),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("hides another community's delivery and its attempts", async () => {
    const { endpoint: target } = await endpoint("/tenant");
    const test = await service().sendTestEvent(owner(), community.id, target.id);
    await jobs().deliver(test.id);
    const outsider = actor(other.members.owner);
    await expect(
      service().getDelivery(outsider, community.id, target.id, test.id),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    await expect(
      service().getDelivery(outsider, other.id, target.id, test.id),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    await expect(
      service().resendDelivery(outsider, other.id, target.id, test.id),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    const { endpoint: own } = await service().createEndpoint(outsider, other.id, {
      url: `${base}/tenant-other`,
      eventTypes: ["post.created"],
    });
    await expect(service().getDelivery(outsider, other.id, own.id, test.id)).rejects.toBeInstanceOf(
      WebhookDeliveryNotFoundError,
    );
    const attempts = await admin.db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.deliveryId, test.id));
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((row) => row.communityId === community.id)).toBe(true);
  });
});
