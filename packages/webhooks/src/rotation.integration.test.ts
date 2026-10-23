import type { Database } from "@cohory/db";
import { webhookEndpoints } from "@cohory/db/schema";
import { createKeyring, keyIdOf } from "@cohory/payments/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openWebhookSecret } from "./env";
import { reencryptWebhookSecrets } from "./rotation";
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
let community: Community;
const oldKey = Buffer.alloc(32, 31);

beforeAll(async () => {
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  community = await seedCommunity(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

describe("re-encrypting webhook endpoint secrets after a key rotation", () => {
  it("moves the signing secret under the new key and keeps it readable", async () => {
    const service = createWebhooksService({
      db: probe.db,
      key: () => oldKey,
      queue: fakeQueue(),
      allowPrivateHosts: ["127.0.0.1"],
    });
    const created = await service.createEndpoint(actor(community.members.owner), community.id, {
      url: "https://hooks.example.test/rotate",
      eventTypes: ["post.created"],
    });
    const ring = createKeyring([testKey, oldKey]);

    const result = await reencryptWebhookSecrets(probe.db, ring);

    expect(result.reencrypted).toBeGreaterThanOrEqual(1);
    const [row] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, created.endpoint.id));
    expect(row?.secretCiphertext.split(".")[1]).toBe(keyIdOf(testKey));
    expect(openWebhookSecret(row?.secretCiphertext ?? "", testKey, created.endpoint.id)).toBe(
      created.secret,
    );
  });

  it("moves the previous secret of an active roll too, so the second signature keeps working", async () => {
    const service = createWebhooksService({
      db: probe.db,
      key: () => oldKey,
      queue: fakeQueue(),
      allowPrivateHosts: ["127.0.0.1"],
    });
    const created = await service.createEndpoint(actor(community.members.owner), community.id, {
      url: "https://hooks.example.test/rotate-roll",
      eventTypes: ["post.created"],
    });
    const rolled = await service.rotateSecret(
      actor(community.members.owner),
      community.id,
      created.endpoint.id,
      { keepPrevious: true },
    );

    await reencryptWebhookSecrets(probe.db, createKeyring([testKey, oldKey]));

    const [row] = await admin.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, created.endpoint.id));
    const previous = row?.previousSecretCiphertext ?? "";
    expect(previous.split(".")[1]).toBe(keyIdOf(testKey));
    expect(openWebhookSecret(previous, testKey, created.endpoint.id)).toBe(created.secret);
    expect(openWebhookSecret(row?.secretCiphertext ?? "", testKey, created.endpoint.id)).toBe(
      rolled.secret,
    );
  });
});
