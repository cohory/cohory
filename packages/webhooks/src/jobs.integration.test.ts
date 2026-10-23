import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { newId, type Database } from "@cohory/db";
import { users, webhookDeliveries, webhookEndpoints } from "@cohory/db/schema";
import { createEgress } from "@cohory/egress";
import type { EmailMessage, Mailer } from "@cohory/email";
import type { WebhookFanoutJobPayload } from "@cohory/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { retryScheduleMs } from "./backoff";
import { createWebhookJobs, endpointConcurrency } from "./jobs";
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

const admin = openDb();
let probe: { db: Database; close: () => Promise<void> };
let server: Server;
let base: string;
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const received: Received[] = [];
let community: Community;
let clock = new Date("2026-10-19T10:00:00.000Z");
const sent: EmailMessage[] = [];
const mailer: Mailer = {
  async send(message) {
    sent.push(message);
  },
};
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

async function endpoint(eventTypes: string[], path = "/hook") {
  return service().createEndpoint(actor(community.members.owner), community.id, {
    url: `${base}${path}`,
    eventTypes: eventTypes as ["post.created"],
  });
}

function fanoutPayload(postId = newId()): WebhookFanoutJobPayload {
  return {
    outboxId: newId(),
    communityId: community.id,
    events: [
      {
        type: "post.created",
        payload: {
          communityId: community.id,
          postId,
          authorId: community.members.member,
          mentionedUserIds: [community.members.admin],
        },
      },
      {
        type: "member.joined",
        payload: {
          communityId: community.id,
          userId: community.members.member,
          role: "member",
          occurredAt: "2026-10-19T09:59:00.000Z",
        },
      },
    ],
  };
}

async function deliveriesOf(endpointId: string) {
  return admin.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId));
}

beforeAll(async () => {
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  community = await seedCommunity(admin.db, "hooks-jobs");
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
  clock = new Date("2026-10-19T10:00:00.000Z");
});

describe("fanout", () => {
  it("creates one delivery per subscribed active endpoint and event, once", async () => {
    const posts = await endpoint(["post.created"]);
    const both = await endpoint(["post.created", "member.joined"]);
    const other = await endpoint(["lesson.completed"]);
    const payload = fanoutPayload();
    expect(await jobs().fanout(payload)).toEqual({ created: 3 });
    expect(await jobs().fanout(payload)).toEqual({ created: 0 });
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect((await deliveriesOf(posts.endpoint.id)).map((d) => d.eventType)).toEqual([
      "post.created",
    ]);
    expect((await deliveriesOf(both.endpoint.id)).map((d) => d.eventType).sort()).toEqual([
      "member.joined",
      "post.created",
    ]);
    expect(await deliveriesOf(other.endpoint.id)).toEqual([]);
    const [delivery] = await deliveriesOf(posts.endpoint.id);
    expect(delivery?.payload).toEqual({
      type: "post.created",
      timestamp: "2026-10-19T10:00:00.000Z",
      data: {
        communityId: community.id,
        postId: payload.events[0]?.type === "post.created" ? payload.events[0].payload.postId : "",
        authorId: community.members.member,
        agentId: null,
      },
    });
  });
});

describe("deliver", () => {
  it("posts a signed Standard Webhooks request the receiver can verify", async () => {
    const { endpoint: target, secret } = await endpoint(["post.created"], "/signed");
    await jobs().fanout(fanoutPayload());
    const [delivery] = await deliveriesOf(target.id);
    const result = await jobs().deliver(delivery?.id ?? "");
    expect(result).toEqual({ kind: "succeeded", status: 204 });
    const request = received.findLast((entry) => entry.path === "/signed");
    expect(request?.headers["webhook-id"]).toBe(delivery?.eventId);
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(() =>
      verifyWebhook({
        secret,
        body: request?.body ?? "",
        headers: {
          "webhook-id": String(request?.headers["webhook-id"]),
          "webhook-timestamp": String(request?.headers["webhook-timestamp"]),
          "webhook-signature": String(request?.headers["webhook-signature"]),
        },
        now: clock,
      }),
    ).not.toThrow();
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({ type: "post.created" });
    const [after] = await deliveriesOf(target.id);
    expect(after).toMatchObject({ status: "succeeded", attempts: 1, responseStatus: 204 });
  });

  it("sends once when two jobs deliver the same delivery at the same time, and never again", async () => {
    let calls = 0;
    respond = (_req, res) => {
      calls += 1;
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 50);
    };
    const { endpoint: target } = await endpoint(["post.created"], "/once");
    await jobs().fanout(fanoutPayload());
    const [delivery] = await deliveriesOf(target.id);
    const results = await Promise.all([
      jobs().deliver(delivery?.id ?? ""),
      jobs().deliver(delivery?.id ?? ""),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["skipped", "succeeded"]);
    expect(await jobs().deliver(delivery?.id ?? "")).toEqual({ kind: "skipped", reason: "done" });
    expect(calls).toBe(1);
  });

  it("retries on the backoff schedule, then disables the endpoint and emails the owner", async () => {
    respond = (_req, res) => {
      res.writeHead(500);
      res.end("down");
    };
    const { endpoint: target } = await endpoint(["post.created", "member.joined"], "/down");
    await jobs().fanout(fanoutPayload());
    const [first, second] = (await deliveriesOf(target.id)).sort((x, y) =>
      x.eventType.localeCompare(y.eventType),
    );
    const id = first?.id ?? "";
    const start = clock.getTime();
    for (const [index, delay] of retryScheduleMs.entries()) {
      const result = await jobs().deliver(id);
      expect(result).toEqual({
        kind: "retry_scheduled",
        at: new Date(clock.getTime() + delay),
        error: "http_500",
      });
      expect(queue.enqueue).toHaveBeenLastCalledWith(id, {
        startAfter: new Date(clock.getTime() + delay),
      });
      const [row] = (await deliveriesOf(target.id)).filter((d) => d.id === id);
      expect(row).toMatchObject({ attempts: index + 1, status: "pending", responseStatus: 500 });
      expect(await jobs().deliver(id)).toEqual({ kind: "skipped", reason: "not_due" });
      clock = new Date(clock.getTime() + delay);
    }
    expect(clock.getTime() - start).toBeLessThan(72 * 60 * 60 * 1000);
    const last = await jobs().deliver(id);
    expect(last).toEqual({ kind: "endpoint_disabled", error: "http_500", emailed: true });
    const [disabled] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, target.id));
    expect(disabled).toMatchObject({
      status: "disabled",
      disabledReason: "failures",
      consecutiveFailures: 10,
    });
    const rows = await deliveriesOf(target.id);
    expect(rows.find((d) => d.id === id)).toMatchObject({ status: "failed", attempts: 10 });
    expect(rows.find((d) => d.id === second?.id)).toMatchObject({
      status: "failed",
      lastError: "endpoint_disabled",
    });
    expect(sent.at(-1)).toMatchObject({
      subject: "[Webhook makers] A webhook endpoint was turned off",
    });
    expect(sent.at(-1)?.text).toContain(`/c/${community.slug}/manage/settings/webhooks`);
  });

  it("disables the endpoint without emailing an owner whose address is not confirmed", async () => {
    const unconfirmed = await seedCommunity(admin.db, "hooks-unconfirmed");
    await admin.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, unconfirmed.members.owner));
    respond = (_req, res) => {
      res.writeHead(500);
      res.end("down");
    };
    const { endpoint: target } = await service().createEndpoint(
      actor(unconfirmed.members.owner),
      unconfirmed.id,
      { url: `${base}/unconfirmed`, eventTypes: ["post.created"] },
    );
    await jobs().fanout({ ...fanoutPayload(), communityId: unconfirmed.id });
    const [delivery] = await deliveriesOf(target.id);
    const before = sent.length;
    for (const delay of retryScheduleMs) {
      await jobs().deliver(delivery?.id ?? "");
      clock = new Date(clock.getTime() + delay);
    }
    expect(await jobs().deliver(delivery?.id ?? "")).toEqual({
      kind: "endpoint_disabled",
      error: "http_500",
      emailed: false,
    });
    expect(sent).toHaveLength(before);
  });

  it("does not disable an endpoint that succeeded after the failing delivery began", async () => {
    let fail = true;
    respond = (_req, res) => {
      res.writeHead(fail ? 503 : 200);
      res.end();
    };
    const { endpoint: target } = await endpoint(["post.created"], "/flaky");
    await jobs().fanout(fanoutPayload());
    await jobs().fanout(fanoutPayload());
    const [failing, healthy] = await deliveriesOf(target.id);
    for (const delay of retryScheduleMs) {
      await jobs().deliver(failing?.id ?? "");
      clock = new Date(clock.getTime() + delay);
    }
    fail = false;
    await jobs().deliver(healthy?.id ?? "");
    fail = true;
    expect(await jobs().deliver(failing?.id ?? "")).toEqual({ kind: "failed", error: "http_503" });
    const [row] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, target.id));
    expect(row?.status).toBe("active");
  });

  it("keeps at most four deliveries in flight per endpoint", async () => {
    const { endpoint: target } = await endpoint(["post.created"], "/busy");
    for (let index = 0; index < endpointConcurrency + 1; index += 1) {
      await jobs().fanout(fanoutPayload());
    }
    const rows = await deliveriesOf(target.id);
    const locked = rows.slice(0, endpointConcurrency).map((row) => row.id);
    for (const id of locked) {
      await admin.db
        .update(webhookDeliveries)
        .set({ lockedUntil: new Date(clock.getTime() + 30_000) })
        .where(eq(webhookDeliveries.id, id));
    }
    const waiting = rows[endpointConcurrency]?.id ?? "";
    const result = await jobs().deliver(waiting);
    expect(result).toEqual({ kind: "busy", retryAt: new Date(clock.getTime() + 10_000) });
    expect(queue.enqueue).toHaveBeenLastCalledWith(waiting, {
      startAfter: new Date(clock.getTime() + 10_000),
    });
  });

  it("records a blocked address as a failure without sending", async () => {
    const svc = createWebhooksService({
      db: probe.db,
      key: () => testKey,
      queue,
      allowPrivateHosts: ["127.0.0.1"],
    });
    const { endpoint: target } = await svc.createEndpoint(
      actor(community.members.owner),
      community.id,
      {
        url: `${base}/blocked`,
        eventTypes: ["post.created"],
      },
    );
    await jobs().fanout(fanoutPayload());
    const [delivery] = await deliveriesOf(target.id);
    const strict = createWebhookJobs({
      db: probe.db,
      key: () => testKey,
      egress: createEgress(),
      queue,
      mailer,
      appUrl: "https://cohory.test",
      now: () => clock,
    });
    const before = received.length;
    expect(await strict.deliver(delivery?.id ?? "")).toMatchObject({
      kind: "retry_scheduled",
      error: "blocked_address",
    });
    expect(received.length).toBe(before);
  });
});

describe("sweep", () => {
  it("enqueues due pending deliveries that no job holds", async () => {
    const { endpoint: target } = await endpoint(["post.created"], "/sweep");
    await jobs().fanout(fanoutPayload());
    const [delivery] = await deliveriesOf(target.id);
    await admin.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(webhookDeliveries.endpointId, target.id));
    queue = fakeQueue();
    const { enqueued } = await jobs().sweep();
    expect(enqueued).toBeGreaterThanOrEqual(1);
    expect(queue.enqueue).toHaveBeenCalledWith(delivery?.id);
  });
});
