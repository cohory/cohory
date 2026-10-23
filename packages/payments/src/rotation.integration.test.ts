import type { Database } from "@cohory/db";
import { paymentConnections } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createKeyring, decryptSecret, encryptSecret, keyIdOf } from "./crypto";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { reencryptConnectionSecrets } from "./rotation";
import {
  communityEnv,
  encryptionKey,
  insertCommunity,
  insertMember,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import { createHarness } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };
const oldKey = Buffer.alloc(32, 21);
const nextKey = encryptionKey;
const rotated = createKeyring([encryptionKey, oldKey]);
const oldEnv = () => communityEnv({ encryptionKeys: createKeyring([oldKey]) });

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

async function sealedRow(id: string) {
  const [row] = await admin.db
    .select()
    .from(paymentConnections)
    .where(eq(paymentConnections.id, id));
  return row;
}

describe("re-encrypting stored payment secrets after a key rotation", () => {
  it("moves every secret under the new key, keeps them readable, and leaves them alone the second time", async () => {
    const harness = createHarness(probe.db, oldEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const connection = await harness.service.connectOwnKeys(owner, communityId, {
      secretKey: "rk_test_rotate123",
      webhookSecret: "whsec_rotate123",
    });
    expect((await sealedRow(connection.id))?.encryptedSecret?.split(".")[1]).toBe(keyIdOf(oldKey));

    const repo = createPostgresPaymentsRepository(probe.db);
    const first = await reencryptConnectionSecrets(repo, rotated);

    expect(first.reencrypted).toBeGreaterThanOrEqual(1);
    const row = await sealedRow(connection.id);
    expect(row?.encryptedSecret?.split(".")[1]).toBe(keyIdOf(nextKey));
    expect(row?.webhookSecretEncrypted?.split(".")[1]).toBe(keyIdOf(nextKey));
    expect(decryptSecret(row?.encryptedSecret ?? "", nextKey, connection.id)).toBe(
      "rk_test_rotate123",
    );
    expect(decryptSecret(row?.webhookSecretEncrypted ?? "", nextKey, connection.id)).toBe(
      "whsec_rotate123",
    );

    const second = await reencryptConnectionSecrets(repo, rotated);
    expect(second.unreadable).not.toContain(connection.id);
    expect(await sealedRow(connection.id)).toEqual(row);
  });

  it("reports a connection whose key left the ring and leaves its row unchanged", async () => {
    const lostKey = Buffer.alloc(32, 22);
    const harness = createHarness(
      probe.db,
      communityEnv({ encryptionKeys: createKeyring([lostKey]) }),
    );
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const connection = await harness.service.connectOwnKeys(owner, communityId, {
      secretKey: "rk_test_lost123",
      webhookSecret: "whsec_lost123",
    });
    const before = await sealedRow(connection.id);

    const result = await reencryptConnectionSecrets(
      createPostgresPaymentsRepository(probe.db),
      rotated,
    );

    expect(result.unreadable).toContain(connection.id);
    expect((await sealedRow(connection.id))?.encryptedSecret).toBe(before?.encryptedSecret);
  });

  it("does not overwrite a secret that changed after the sweep read it", async () => {
    const harness = createHarness(probe.db, communityEnv());
    const communityId = await insertCommunity(admin.db);
    const owner = user(await insertMember(admin.db, communityId, "owner"));
    const connection = await harness.service.connectOwnKeys(owner, communityId, {
      secretKey: "rk_test_race123",
      webhookSecret: "whsec_race123",
    });
    const repo = createPostgresPaymentsRepository(probe.db);
    const stale = (await repo.listSealedConnections(null, 10_000)).find(
      (row) => row.id === connection.id,
    );
    if (!stale) throw new Error("connection not listed");
    const replaced = encryptSecret("rk_test_newer", nextKey, connection.id);
    await admin.db
      .update(paymentConnections)
      .set({ encryptedSecret: replaced })
      .where(eq(paymentConnections.id, connection.id));

    const applied = await repo.replaceSealedSecrets(stale, {
      encryptedSecret: encryptSecret("rk_test_race123", nextKey, connection.id),
      webhookSecretEncrypted: stale.webhookSecretEncrypted,
    });

    expect(applied).toBe(false);
    expect((await sealedRow(connection.id))?.encryptedSecret).toBe(replaced);
  });
});
