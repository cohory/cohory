import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, newId, type CommunitySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devPaidSeed, devSeed } from "@cohory/db/seed";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { PaymentsEnv } from "./config";
import type { StripeGateway } from "./gateway";
import { createPostgresPaymentsRepository } from "./postgres-repository";
import { createPaymentsService } from "./service";
import { statePatch } from "./service/connection";

export class PaidSeedRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PaidSeedRefusedError";
  }
}

export function paidSeedSecretKey(source: Readonly<Record<string, string | undefined>>): string {
  if (source.NODE_ENV === "production") {
    throw new PaidSeedRefusedError("the paid dev seed never runs when NODE_ENV is production");
  }
  const key = source.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    throw new PaidSeedRefusedError(
      "the paid dev seed needs a Stripe sandbox secret key (sk_test_) in STRIPE_SECRET_KEY",
    );
  }
  return key;
}

const accountIdSchema = z.string().regex(/^acct_[A-Za-z0-9]+$/);

export function paidSeedAccountId(source: Readonly<Record<string, string | undefined>>): string {
  const configured = source.PAID_SEED_ACCOUNT_ID;
  if (!configured) {
    throw new PaidSeedRefusedError(
      "set PAID_SEED_ACCOUNT_ID to the connected account (acct_) in your Stripe sandbox",
    );
  }
  const parsed = accountIdSchema.safeParse(configured);
  if (!parsed.success) {
    throw new PaidSeedRefusedError("PAID_SEED_ACCOUNT_ID must be a connected account id (acct_)");
  }
  return parsed.data;
}

export interface PaidSeedDeps {
  readonly db: Database;
  readonly env: PaymentsEnv;
  readonly gateway: StripeGateway;
  readonly accountId: string;
  readonly communitySlug?: CommunitySlug;
  readonly ownerEmail?: string;
}

export interface PaidSeedResult {
  readonly communityId: string;
  readonly accountId: string;
  readonly connectionId: string;
  readonly connectionCreated: boolean;
  readonly planId: string;
  readonly planCreated: boolean;
  readonly productId: string | null;
  readonly monthlyPriceId: string | null;
  readonly annualPriceId: string | null;
  readonly platformFeeBps: number;
}

async function seededOwnerId(db: Database, email: string): Promise<string> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!owner) {
    throw new PaidSeedRefusedError("run pnpm db:seed before the paid dev seed");
  }
  return owner.id;
}

export async function seedDevPaidPayments(deps: PaidSeedDeps): Promise<PaidSeedResult> {
  const { db, env, gateway } = deps;
  const { accountId } = deps;
  const slug = deps.communitySlug ?? devPaidSeed.communitySlug;
  if (env.edition !== "cloud") {
    throw new PaidSeedRefusedError(
      "the paid dev seed connects through Stripe Connect, so set COHORY_EDITION=cloud",
    );
  }
  const community = await getCommunityBySlug(db, slug);
  if (!community) {
    throw new PaidSeedRefusedError(`run pnpm db:seed first: the community ${slug} does not exist`);
  }
  const ownerId = await seededOwnerId(db, deps.ownerEmail ?? devSeed.email);
  const account = await gateway.retrieveConnectedAccount(accountId);
  if (account.livemode) {
    throw new PaidSeedRefusedError(`${accountId} is a live account; use a sandbox account`);
  }
  if (!account.chargesEnabled) {
    throw new PaidSeedRefusedError(
      `${accountId} cannot take charges yet; finish its onboarding in the Stripe Dashboard`,
    );
  }

  const repo = createPostgresPaymentsRepository(db);
  const elsewhere = await repo.findConnectionByAccount(accountId);
  if (elsewhere && elsewhere.communityId !== community.id) {
    throw new PaidSeedRefusedError(
      `${accountId} is already connected to community ${elsewhere.communityId}; disconnect it there first`,
    );
  }
  const { connection, created: connectionCreated } = await repo.inCommunityAsSystem(
    community.id,
    async (store) => {
      await store.enableManagement();
      const open = await store.findOpenConnection();
      if (open) {
        if (open.provider !== "stripe_connect" || open.externalAccountId !== accountId) {
          throw new PaidSeedRefusedError(`${slug} already has a different payment connection`);
        }
        return { connection: open, created: false };
      }
      const inserted = await store.insertConnection({
        id: newId(),
        provider: "stripe_connect",
        externalAccountId: accountId,
        acceptedOwnerId: ownerId,
        ...statePatch(account),
      });
      return { connection: inserted, created: true };
    },
  );

  const before = await repo.inCommunityAsSystem(community.id, (store) => store.findActivePlan());
  const service = createPaymentsService({ repo, env, platformGateway: gateway });
  const owner: Actor = { kind: "user", userId: ownerId, platformAdmin: false };
  const plan = await service.upsertPlan(owner, community.id, {
    name: devPaidSeed.planName,
    currency: devPaidSeed.currency,
    monthlyPriceMinor: devPaidSeed.monthlyPriceMinor,
    annualPriceMinor: devPaidSeed.annualPriceMinor,
  });
  const after = await repo.inCommunityAsSystem(community.id, (store) => store.findActivePlan());

  return {
    communityId: community.id,
    accountId,
    connectionId: connection.id,
    connectionCreated,
    planId: plan.id,
    planCreated: before?.id !== plan.id,
    productId: after?.providerProductId ?? null,
    monthlyPriceId: after?.providerMonthlyPriceId ?? null,
    annualPriceId: after?.providerAnnualPriceId ?? null,
    platformFeeBps: env.platformFeeBps,
  };
}
