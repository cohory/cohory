import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { CommunityNotFoundError, CommunityValidationError } from "@cohory/communities";
import { runInCommunity, setRlsFlag, withCommunity, type Database } from "@cohory/db";
import { auditLog, webhookDeliveries, webhookEndpoints } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openWebhookSecret } from "./env";
import { WebhookEndpointDisabledError, WebhookEndpointNotFoundError } from "./errors";
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

const admin = openDb();
let probe: { db: Database; close: () => Promise<void> };
let a: Community;
let b: Community;
const queue = fakeQueue();
let service: ReturnType<typeof createWebhooksService>;

const input = {
  url: "https://hooks.example.com/cohory",
  description: "Zapier",
  eventTypes: ["post.created", "member.joined", "post.created"] as const,
};

beforeAll(async () => {
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  a = await seedCommunity(admin.db, "hooks-a");
  b = await seedCommunity(admin.db, "hooks-b");
  service = createWebhooksService({ db: probe.db, key: () => testKey, queue });
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("permissions", () => {
  it.each(["owner", "admin"] as const)("lets the %s list and create endpoints", async (role) => {
    const created = await service.createEndpoint(actor(a.members[role]), a.id, {
      ...input,
      eventTypes: [...input.eventTypes],
    });
    expect(created.endpoint.eventTypes).toEqual(["member.joined", "post.created"]);
    const listed = await service.listEndpoints(actor(a.members[role]), a.id);
    expect(listed.map((endpoint) => endpoint.id)).toContain(created.endpoint.id);
  });

  it.each(["moderator", "member"] as const)("refuses a %s", async (role) => {
    await expect(service.listEndpoints(actor(a.members[role]), a.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.createEndpoint(actor(a.members[role]), a.id, {
        ...input,
        eventTypes: ["post.created"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a guest and hides the community from an outsider", async () => {
    await expect(service.listEndpoints({ kind: "guest" }, a.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(service.listEndpoints(actor(b.members.owner), a.id)).rejects.toBeInstanceOf(
      CommunityNotFoundError,
    );
  });
});

describe("endpoints", () => {
  it("shows the secret once, stores it encrypted, and audits the change", async () => {
    const { endpoint, secret } = await service.createEndpoint(actor(a.members.owner), a.id, {
      ...input,
      eventTypes: ["post.created"],
    });
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify(endpoint)).not.toContain(secret);
    const [row] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(row?.secretCiphertext).not.toContain(secret.slice(6));
    expect(openWebhookSecret(row?.secretCiphertext ?? "", testKey, endpoint.id)).toBe(secret);
    const audits = await admin.db.select().from(auditLog).where(eq(auditLog.target, endpoint.id));
    expect(audits.map((entry) => entry.action)).toEqual(["webhook.created"]);
  });

  it("rejects plain http, private addresses, local names, and an empty event list", async () => {
    for (const url of [
      "http://hooks.example.com/",
      "https://127.0.0.1/",
      "https://10.0.0.8/",
      "https://[::1]/",
      "https://localhost/",
      "https://printer.local/",
      "https://intranet/",
    ]) {
      await expect(
        service.createEndpoint(actor(a.members.owner), a.id, { url, eventTypes: ["post.created"] }),
      ).rejects.toBeInstanceOf(CommunityValidationError);
    }
    await expect(
      service.createEndpoint(actor(a.members.owner), a.id, { url: input.url, eventTypes: [] }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("accepts an http receiver only when its host is on the private host override", async () => {
    const local = createWebhooksService({
      db: probe.db,
      key: () => testKey,
      queue,
      allowPrivateHosts: ["127.0.0.1"],
    });
    const { endpoint } = await local.createEndpoint(actor(a.members.owner), a.id, {
      url: "http://127.0.0.1:4100/hooks",
      eventTypes: ["post.created"],
    });
    expect(endpoint.url).toBe("http://127.0.0.1:4100/hooks");
  });

  it("rotates the secret", async () => {
    const created = await service.createEndpoint(actor(a.members.admin), a.id, {
      url: input.url,
      eventTypes: ["comment.created"],
    });
    const rotated = await service.rotateSecret(actor(a.members.admin), a.id, created.endpoint.id);
    expect(rotated.secret).not.toBe(created.secret);
    const [row] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, created.endpoint.id));
    expect(openWebhookSecret(row?.secretCiphertext ?? "", testKey, created.endpoint.id)).toBe(
      rotated.secret,
    );
  });

  it("sends a test event, then disabling fails pending deliveries and refuses more tests", async () => {
    const { endpoint } = await service.createEndpoint(actor(a.members.owner), a.id, {
      url: input.url,
      eventTypes: ["member.removed"],
    });
    const delivery = await service.sendTestEvent(actor(a.members.owner), a.id, endpoint.id);
    expect(delivery).toMatchObject({ eventType: "webhook.test", status: "pending", attempts: 0 });
    expect(queue.enqueue).toHaveBeenCalledWith(delivery.id);
    const disabled = await service.disableEndpoint(actor(a.members.owner), a.id, endpoint.id);
    expect(disabled).toMatchObject({ status: "disabled", disabledReason: "manual" });
    const page = await service.listDeliveries(actor(a.members.owner), a.id, endpoint.id);
    expect(page.data).toEqual([
      expect.objectContaining({
        id: delivery.id,
        status: "failed",
        lastError: "endpoint_disabled",
      }),
    ]);
    await expect(
      service.sendTestEvent(actor(a.members.owner), a.id, endpoint.id),
    ).rejects.toBeInstanceOf(WebhookEndpointDisabledError);
    const enabled = await service.enableEndpoint(actor(a.members.owner), a.id, endpoint.id);
    expect(enabled).toMatchObject({
      status: "active",
      disabledReason: null,
      consecutiveFailures: 0,
    });
  });

  it("pages deliveries newest first", async () => {
    const { endpoint } = await service.createEndpoint(actor(a.members.owner), a.id, {
      url: input.url,
      eventTypes: ["post.created"],
    });
    const sent = [];
    for (let index = 0; index < 3; index += 1) {
      sent.push(await service.sendTestEvent(actor(a.members.owner), a.id, endpoint.id));
    }
    const first = await service.listDeliveries(actor(a.members.owner), a.id, endpoint.id, {
      limit: 2,
    });
    expect(first.data.map((d) => d.id)).toEqual([sent[2]?.id, sent[1]?.id]);
    const second = await service.listDeliveries(actor(a.members.owner), a.id, endpoint.id, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data.map((d) => d.id)).toEqual([sent[0]?.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("deletes an endpoint and its deliveries", async () => {
    const { endpoint } = await service.createEndpoint(actor(a.members.owner), a.id, {
      url: input.url,
      eventTypes: ["post.created"],
    });
    await service.sendTestEvent(actor(a.members.owner), a.id, endpoint.id);
    await service.deleteEndpoint(actor(a.members.owner), a.id, endpoint.id);
    await expect(
      service.getEndpoint(actor(a.members.owner), a.id, endpoint.id),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    const left = await admin.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id));
    expect(left).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("does not let one community's admin reach another community's endpoint", async () => {
    const { endpoint } = await service.createEndpoint(actor(b.members.owner), b.id, {
      url: input.url,
      eventTypes: ["post.created"],
    });
    await expect(
      service.getEndpoint(actor(a.members.owner), a.id, endpoint.id),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
    await expect(
      service.disableEndpoint(actor(a.members.owner), a.id, endpoint.id),
    ).rejects.toBeInstanceOf(WebhookEndpointNotFoundError);
  });

  it("hides endpoint rows from a scoped query without the manager setting or of another community", async () => {
    await service.createEndpoint(actor(b.members.owner), b.id, {
      url: input.url,
      eventTypes: ["post.created"],
    });
    const withoutManager = await runInCommunity(withCommunity(probe.db, b.id), ({ tx }) =>
      tx.select().from(webhookEndpoints),
    );
    expect(withoutManager).toEqual([]);
    const otherCommunity = await runInCommunity(withCommunity(probe.db, a.id), async ({ tx }) => {
      await setRlsFlag(tx, "webhooks_manager");
      return tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.communityId, b.id));
    });
    expect(otherCommunity).toEqual([]);
    await expect(
      runInCommunity(withCommunity(probe.db, a.id), async ({ tx }) => {
        await setRlsFlag(tx, "webhooks_manager");
        await tx.insert(webhookEndpoints).values({
          communityId: b.id,
          url: input.url,
          eventTypes: ["post.created"],
          secretCiphertext: "x",
        });
      }),
    ).rejects.toThrow();
  });
});
