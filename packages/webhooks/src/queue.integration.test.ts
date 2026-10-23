import { parseAdminDatabaseEnv } from "@cohory/db";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDeliveryQueue, webhooksDeliverJob } from "./queue";
import { createWebhooksService } from "./service";
import {
  actor,
  ensureProbeRole,
  openDb,
  probeRole,
  seedCommunity,
  testKey,
  type Community,
} from "./test/fixtures";

const bossSchema = "pgboss_webhooks_queue_test";
const boss = new PgBoss({
  connectionString: parseAdminDatabaseEnv().DATABASE_ADMIN_URL,
  schema: bossSchema,
  supervise: false,
  schedule: false,
});
const admin = openDb();
let probe: ReturnType<typeof openDb>;
let community: Community;

function service() {
  return createWebhooksService({
    db: probe.db,
    key: () => testKey,
    queue: createDeliveryQueue(async () => boss),
    allowPrivateHosts: ["127.0.0.1"],
  });
}

async function takeJob(): Promise<string | null> {
  const [job] = await boss.fetch<{ deliveryId: string }>(webhooksDeliverJob);
  if (!job) return null;
  await boss.complete(webhooksDeliverJob, job.id);
  return job.data.deliveryId;
}

beforeAll(async () => {
  await boss.start();
  await ensureProbeRole(admin.db);
  probe = openDb(probeRole);
  community = await seedCommunity(admin.db, "hooks-queue");
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await admin.db.execute(sql.raw(`drop schema if exists ${bossSchema} cascade`));
  await probe.close();
  await admin.close();
});

describe("delivery queue", () => {
  it("queues a resend right after the first attempt finished", async () => {
    const owner = actor(community.members.owner);
    const { endpoint } = await service().createEndpoint(owner, community.id, {
      url: "http://127.0.0.1:9/resend",
      eventTypes: ["post.created"],
    });
    const test = await service().sendTestEvent(owner, community.id, endpoint.id);
    expect(await takeJob()).toBe(test.id);

    await service().resendDelivery(owner, community.id, endpoint.id, test.id);
    expect(await takeJob()).toBe(test.id);
  });

  it("queues each delivery once when it is enqueued twice at once", async () => {
    const queue = createDeliveryQueue(async () => boss);
    const deliveryId = "0199f000-0000-7000-8000-000000000001";
    await queue.enqueue(deliveryId);
    await queue.enqueue(deliveryId);
    expect(await takeJob()).toBe(deliveryId);
    expect(await takeJob()).toBeNull();
  });
});
