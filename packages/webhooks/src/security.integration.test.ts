import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { newId, type Database } from "@cohory/db";
import { webhookDeliveries } from "@cohory/db/schema";
import { createEgress, type Egress, type LookupAll } from "@cohory/egress";
import type { Mailer } from "@cohory/email";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createWebhookJobs } from "./jobs";
import { createWebhooksService } from "./service";
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
let receiver: Server;
let internal: Server;
let receiverPort = 0;
let internalPort = 0;
let community: Community;
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const received: Received[] = [];
const internalHits: string[] = [];
const mailer: Mailer = { send: async () => undefined };
const receiverHost = "receiver.test";

const lookup: LookupAll = async (hostname) => {
  const table: Record<string, string[]> = {
    [receiverHost]: ["127.0.0.1"],
    "rebind.test": ["10.0.0.7"],
    "metadata.test": ["169.254.169.254"],
  };
  const addresses = table[hostname];
  if (!addresses) {
    throw Object.assign(new Error(`not found ${hostname}`), { code: "ENOTFOUND" });
  }
  return addresses.map((address) => ({ address, family: 4 }));
};

function egress(maxRedirects = 0): Egress {
  return createEgress({
    allowPrivateHosts: [receiverHost],
    lookup,
    timeoutMs: 2000,
    maxResponseBytes: 4096,
    maxRedirects,
  });
}

function jobs(target: Egress = egress()) {
  return createWebhookJobs({
    db: probe.db,
    key: () => testKey,
    egress: target,
    queue: fakeQueue(),
    mailer,
    appUrl: "https://cohory.test",
    timeoutMs: 2000,
  });
}

function service(allowPrivateHosts: readonly string[] = [receiverHost]) {
  return createWebhooksService({
    db: probe.db,
    key: () => testKey,
    queue: fakeQueue(),
    allowPrivateHosts,
  });
}

async function deliveryFor(path: string) {
  const created = await service().createEndpoint(actor(community.members.owner), community.id, {
    url: `http://${receiverHost}:${receiverPort}${path}`,
    eventTypes: ["post.created"],
  });
  await jobs().fanout({
    outboxId: newId(),
    communityId: community.id,
    events: [
      {
        type: "post.created",
        payload: {
          communityId: community.id,
          postId: newId(),
          authorId: community.members.member,
          mentionedUserIds: [],
        },
      },
    ],
  });
  const [delivery] = await admin.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, created.endpoint.id));
  if (!delivery) throw new Error("no delivery");
  return { ...created, delivery };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

beforeAll(async () => {
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  community = await seedCommunity(admin.db, "hooks-sec");
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body, path: req.url ?? "" });
      respond(req, res);
    });
  });
  internal = createServer((req, res) => {
    internalHits.push(req.url ?? "");
    res.end("internal secrets");
  });
  receiverPort = await listen(receiver);
  internalPort = await listen(internal);
});

afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await new Promise<void>((resolve) => internal.close(() => resolve()));
  await probe.close();
  await admin.close();
});

beforeEach(() => {
  internalHits.length = 0;
  respond = (_req, res) => {
    res.writeHead(204);
    res.end();
  };
});

describe("webhook egress", () => {
  it("refuses endpoint URLs on loopback, private, link local, metadata, and local names", async () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://localhost/hook",
      "https://metadata.google.internal/computeMetadata/v1/",
      "http://hooks.example.com/plain-http",
      "https://user:pass@hooks.example.com/hook",
    ]) {
      await expect(
        service([]).createEndpoint(actor(community.members.owner), community.id, {
          url,
          eventTypes: ["post.created"],
        }),
        url,
      ).rejects.toMatchObject({ name: "CommunityValidationError" });
    }
  });

  it("does not follow a receiver's redirect to loopback or the metadata address", async () => {
    for (const location of [
      `http://127.0.0.1:${internalPort}/admin`,
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      respond = (_req, res) => {
        res.writeHead(302, { location });
        res.end();
      };
      const { delivery } = await deliveryFor(`/redirect-${newId().slice(-6)}`);
      const result = await jobs().deliver(delivery.id);
      expect(result).toMatchObject({ kind: "retry_scheduled", error: "http_302" });
    }
    expect(internalHits).toEqual([]);
  });

  it("blocks every redirect hop to a private, metadata, or rebinding address when an operator enables redirects", async () => {
    const follow = egress(3);
    for (const location of [
      `http://127.0.0.1:${internalPort}/admin`,
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.test/latest/meta-data/",
      `http://rebind.test:${internalPort}/admin`,
    ]) {
      respond = (_req, res) => {
        res.writeHead(307, { location });
        res.end();
      };
      await expect(
        follow({ url: `http://${receiverHost}:${receiverPort}/start`, method: "POST", body: "{}" }),
        location,
      ).rejects.toMatchObject({ name: "EgressBlockedError", reason: "private_address" });
    }
    expect(internalHits).toEqual([]);
  });
});

describe("webhook signatures and secrets", () => {
  it("signs deliveries that the reference Standard Webhooks library verifies, and never logs the secret", async () => {
    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(capture),
      vi.spyOn(console, "info").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture),
      vi.spyOn(console, "error").mockImplementation(capture),
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }),
    ];
    try {
      const path = `/signed-${newId().slice(-6)}`;
      const { delivery, secret, endpoint } = await deliveryFor(path);
      expect(await jobs().deliver(delivery.id)).toEqual({ kind: "succeeded", status: 204 });
      const request = received.findLast((entry) => entry.path === path);
      if (!request) throw new Error("no request");
      const headers = {
        "webhook-id": String(request.headers["webhook-id"]),
        "webhook-timestamp": String(request.headers["webhook-timestamp"]),
        "webhook-signature": String(request.headers["webhook-signature"]),
      };
      expect(new Webhook(secret).verify(request.body, headers)).toMatchObject({
        type: "post.created",
      });
      expect(() => new Webhook(secret).verify(`${request.body} `, headers)).toThrow();
      const other = `whsec_${Buffer.alloc(24, 1).toString("base64")}`;
      expect(() => new Webhook(other).verify(request.body, headers)).toThrow();

      const rotated = await service().rotateSecret(
        actor(community.members.owner),
        community.id,
        endpoint.id,
      );
      respond = (_req, res) => {
        res.writeHead(500);
        res.end();
      };
      const failing = await deliveryFor(`/failing-${newId().slice(-6)}`);
      await jobs().deliver(failing.delivery.id);

      const logged = output.join("\n");
      for (const value of [secret, rotated.secret, failing.secret]) {
        expect(logged).not.toContain(value);
        expect(logged).not.toContain(value.slice("whsec_".length));
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
