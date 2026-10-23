import type { CommunityId, Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PaymentsEnv } from "./config";
import { EmailNotConfirmedError } from "./errors";
import {
  cloudEnv,
  communityEnv,
  insertCommunity,
  insertMember,
  openProbeDb,
  openTestDb,
  user,
} from "./test/fixtures";
import { createHarness, type Harness } from "./test/harness";

const admin = openTestDb();
let probe: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  probe = await openProbeDb(admin.db);
});

afterAll(async () => {
  await probe.close();
  await admin.close();
});

interface Owner {
  readonly harness: Harness;
  readonly communityId: CommunityId;
  readonly ownerId: string;
}

async function ownerWith(
  emailVerified: boolean,
  env: PaymentsEnv,
  requireConfirmedEmail = true,
): Promise<Owner> {
  const harness = createHarness(probe.db, env, null, { requireConfirmedEmail });
  const communityId = await insertCommunity(admin.db);
  const ownerId = await insertMember(admin.db, communityId, "owner");
  await admin.db.update(users).set({ emailVerified }).where(eq(users.id, ownerId));
  return { harness, communityId, ownerId };
}

const ownKeys = { secretKey: "rk_test_owner123", webhookSecret: "whsec_owner123" };
const polar = { provider: "polar", accessToken: "polar_oat_fake_token_for_tests_only" } as const;

describe("connecting a payment account needs a confirmed email", () => {
  it("refuses Stripe Connect for an owner whose email is not confirmed", async () => {
    const { harness, communityId, ownerId } = await ownerWith(false, cloudEnv());

    await expect(
      harness.service.connectStripe(user(ownerId), communityId, { acceptCreatorTerms: true }),
    ).rejects.toBeInstanceOf(EmailNotConfirmedError);
    expect(harness.gateway.accounts.size).toBe(0);
  });

  it("refuses own Stripe keys for an owner whose email is not confirmed", async () => {
    const { harness, communityId, ownerId } = await ownerWith(false, communityEnv());

    await expect(
      harness.service.connectOwnKeys(user(ownerId), communityId, ownKeys),
    ).rejects.toMatchObject({ code: "email_not_confirmed" });
  });

  it("refuses another provider for an owner whose email is not confirmed", async () => {
    const { harness, communityId, ownerId } = await ownerWith(false, cloudEnv());

    await expect(
      harness.service.connectProvider(user(ownerId), communityId, polar),
    ).rejects.toBeInstanceOf(EmailNotConfirmedError);
  });

  it("connects once the email is confirmed", async () => {
    const { harness, communityId, ownerId } = await ownerWith(true, cloudEnv());

    const { connection } = await harness.service.connectStripe(user(ownerId), communityId, {
      acceptCreatorTerms: true,
    });

    expect(connection.provider).toBe("stripe_connect");
  });

  it("does not ask for a confirmation when this server cannot send email", async () => {
    const { harness, communityId, ownerId } = await ownerWith(false, communityEnv(), false);

    const view = await harness.service.connectOwnKeys(user(ownerId), communityId, ownKeys);

    expect(view.provider).toBe("stripe_own_keys");
  });
});
