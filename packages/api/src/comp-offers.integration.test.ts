import { createAgentsService } from "@cohory/agents";
import type { UserActor } from "@cohory/authz";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import {
  addMembership,
  createDb,
  createPool,
  getMembership,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { membershipPlans, paymentConnections, users } from "@cohory/db/schema";
import {
  createPaymentsService,
  createPostgresPaymentsRepository,
  type PaymentsEnv,
  type PaymentsService,
} from "@cohory/payments";
import { createKeyring } from "@cohory/payments/crypto";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { afterAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";

const pool = createPool(parseDatabaseEnv().DATABASE_URL);
const db = createDb(pool);
const agents = createAgentsService({ db });
const communities = createCommunitiesService(createPostgresCommunitiesRepository(db));
const posts = createPostsService({
  repo: createPostgresPostsRepository(db),
  storage: {
    put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
    publicUrl: (key) => key,
  },
});
const sessionHeader = "x-test-user";

function paymentsEnv(edition: PaymentsEnv["edition"]): PaymentsEnv {
  return {
    edition,
    platformFeeBps: edition === "cloud" ? 200 : 0,
    nodeEnv: "test",
    stripeSecretKey: null,
    webhookSecrets: [],
    encryptionKeys: createKeyring([Buffer.alloc(32, 5)]),
    appUrl: "http://localhost:3000",
    stripeApiBaseUrl: null,
    polarApiBaseUrl: null,
    connectClientId: null,
    polarEnabled: false,
    creatorTermsVersion: "1",
    subscriptionLinking: edition === "community",
  };
}

function apiFor(payments: PaymentsService) {
  return createApi(() =>
    apiDeps({
      resolveSession: async (headers) => {
        const userId = headers.get(sessionHeader);
        return userId ? { userId } : null;
      },
      communities,
      posts,
      agents,
      payments,
      rateLimiter: createRateLimiter({
        rules: { ...rateLimitDefaults, apiToken: { max: 10_000, windowSeconds: 60 } },
      }),
    }),
  );
}

const cloud = createPaymentsService({
  repo: createPostgresPaymentsRepository(db),
  env: paymentsEnv("cloud"),
});
const communityEdition = createPaymentsService({
  repo: createPostgresPaymentsRepository(db),
  env: paymentsEnv("community"),
});
const cloudApi = apiFor(cloud);
const communityApi = apiFor(communityEdition);

afterAll(async () => {
  await pool.end();
});

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function insertUser(
  name: string,
  emailVerified = true,
): Promise<{ id: string; email: string }> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `offers-${newId()}@example.test`, emailVerified })
    .returning({ id: users.id, email: users.email });
  if (!row) throw new Error("no user");
  return row;
}

async function paidCommunity(): Promise<{ communityId: CommunityId; ownerId: string }> {
  const owner = await insertUser("Offers owner");
  const created = await communities.createCommunity(user(owner.id), {
    name: "Offers",
    slug: `offers-${newId().slice(-12)}`,
  });
  const communityId = parseCommunityId(created.community.id);
  const [connection] = await db
    .insert(paymentConnections)
    .values({
      communityId,
      provider: "stripe_connect",
      externalAccountId: `acct_${newId().replace(/-/g, "").slice(-16)}`,
      status: "active",
      chargesEnabled: true,
      detailsSubmitted: true,
    })
    .returning({ id: paymentConnections.id });
  if (!connection) throw new Error("no connection");
  await db.insert(membershipPlans).values({
    communityId,
    connectionId: connection.id,
    name: "Membership",
    currency: "usd",
    monthlyPriceMinor: 4900,
  });
  return { communityId, ownerId: owner.id };
}

async function offer(communityId: CommunityId, ownerId: string, email: string): Promise<string> {
  const result = await cloud.grantComp(user(ownerId), communityId, { email, note: "Speaker" });
  if (result.kind !== "invited") throw new Error("expected an invitation");
  return result.invitation.id;
}

type Api = ReturnType<typeof apiFor>;

async function request(
  api: Api,
  path: string,
  init: { method?: string; userId?: string; token?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.userId) headers.set(sessionHeader, init.userId);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return api.request(`/api/v1${path}`, { method: init.method ?? "GET", headers });
}

function offersPath(communityId: string): string {
  return `/communities/${communityId}/payments/comps/offers`;
}

function acceptPath(communityId: string, invitationId: string): string {
  return `${offersPath(communityId)}/${invitationId}/accept`;
}

async function membershipStatus(communityId: CommunityId, userId: string) {
  return (await getMembership(withCommunity(db, communityId), userId))?.status ?? null;
}

describe("comped access offers through the API", () => {
  it("lets the invited person list and accept the offer with a session", async () => {
    const { communityId, ownerId } = await paidCommunity();
    const invitee = await insertUser("Invitee");
    const invitationId = await offer(communityId, ownerId, invitee.email.toUpperCase());

    const listed = await request(cloudApi, offersPath(communityId), { userId: invitee.id });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      data: [{ id: invitationId, expiresAt: null }],
      nextCursor: null,
      waitingForVerification: false,
    });

    const accepted = await request(cloudApi, acceptPath(communityId, invitationId), {
      method: "POST",
      userId: invitee.id,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      userId: invitee.id,
      note: "Speaker",
      status: "active",
    });
    expect(await membershipStatus(communityId, invitee.id)).toBe("active");

    const after = await request(cloudApi, offersPath(communityId), { userId: invitee.id });
    expect(await after.json()).toEqual({
      data: [],
      nextCursor: null,
      waitingForVerification: false,
    });
  });

  it("tells an unconfirmed address to confirm first and refuses to accept", async () => {
    const { communityId, ownerId } = await paidCommunity();
    const invitee = await insertUser("Unconfirmed", false);
    const invitationId = await offer(communityId, ownerId, invitee.email);

    const listed = await request(cloudApi, offersPath(communityId), { userId: invitee.id });
    expect(await listed.json()).toEqual({
      data: [],
      nextCursor: null,
      waitingForVerification: true,
    });
    const accepted = await request(cloudApi, acceptPath(communityId, invitationId), {
      method: "POST",
      userId: invitee.id,
    });
    expect(accepted.status).toBe(404);
    expect(await membershipStatus(communityId, invitee.id)).toBeNull();
  });

  it("hides the offer from everyone else, including the owner who sent it", async () => {
    const { communityId, ownerId } = await paidCommunity();
    const invitee = await insertUser("Invitee");
    const stranger = await insertUser("Stranger");
    const invitationId = await offer(communityId, ownerId, invitee.email);

    for (const userId of [stranger.id, ownerId]) {
      const listed = await request(cloudApi, offersPath(communityId), { userId });
      expect(await listed.json()).toEqual({
        data: [],
        nextCursor: null,
        waitingForVerification: false,
      });
      const accepted = await request(cloudApi, acceptPath(communityId, invitationId), {
        method: "POST",
        userId,
      });
      expect(accepted.status).toBe(404);
    }
    const signedOut = await request(cloudApi, acceptPath(communityId, invitationId), {
      method: "POST",
    });
    expect(signedOut.status).toBe(401);
    expect(await membershipStatus(communityId, stranger.id)).toBeNull();

    const listed = await request(cloudApi, offersPath(communityId), { userId: invitee.id });
    expect(await listed.json()).toMatchObject({ data: [{ id: invitationId }] });
  });

  it("refuses personal and agent tokens, even the invited person's own", async () => {
    const { communityId, ownerId } = await paidCommunity();
    const invitee = await insertUser("Lapsed member");
    await addMembership(withCommunity(db, communityId), {
      userId: invitee.id,
      role: "member",
      status: "active",
      joinedAt: new Date(),
    });
    const invitationId = await offer(communityId, ownerId, invitee.email);
    const personal = (
      await agents.createPersonalToken(user(invitee.id), {
        communityId,
        name: "Mine",
        scopes: ["community:read"],
      })
    ).token;
    const agent = await agents.createAgent(user(invitee.id), communityId, {
      name: "Helper",
      scopes: ["courses:read", "proposals:write"],
    });
    const agentToken = (
      await agents.issueAgentToken(user(invitee.id), communityId, agent.id, { name: "Key" })
    ).token;

    for (const token of [personal, agentToken]) {
      const listed = await request(cloudApi, offersPath(communityId), { token });
      expect(listed.status).toBe(403);
      expect(((await listed.json()) as { error: { code: string } }).error.code).toBe(
        "token_not_allowed",
      );
      const accepted = await request(cloudApi, acceptPath(communityId, invitationId), {
        method: "POST",
        token,
      });
      expect(accepted.status).toBe(403);
      expect(((await accepted.json()) as { error: { code: string } }).error.code).toBe(
        "token_not_allowed",
      );
    }
    const pending = await request(cloudApi, offersPath(communityId), { userId: invitee.id });
    expect(await pending.json()).toMatchObject({ data: [{ id: invitationId }] });
  });

  it("does not accept an offer through another community", async () => {
    const first = await paidCommunity();
    const second = await paidCommunity();
    const invitee = await insertUser("Invitee");
    const invitationId = await offer(first.communityId, first.ownerId, invitee.email);

    const listed = await request(cloudApi, offersPath(second.communityId), {
      userId: invitee.id,
    });
    expect(await listed.json()).toEqual({
      data: [],
      nextCursor: null,
      waitingForVerification: false,
    });
    const accepted = await request(cloudApi, acceptPath(second.communityId, invitationId), {
      method: "POST",
      userId: invitee.id,
    });
    expect(accepted.status).toBe(404);
    expect(await membershipStatus(second.communityId, invitee.id)).toBeNull();
    expect(await membershipStatus(first.communityId, invitee.id)).toBeNull();

    const own = await request(cloudApi, acceptPath(first.communityId, invitationId), {
      method: "POST",
      userId: invitee.id,
    });
    expect(own.status).toBe(200);
  });

  it("on the Community Edition grants by email at once, so the person has no offer to accept", async () => {
    const { communityId, ownerId } = await paidCommunity();
    const person = await insertUser("Guest");

    const result = await communityEdition.grantComp(user(ownerId), communityId, {
      email: person.email,
    });

    expect(result.kind).toBe("granted");
    expect(await membershipStatus(communityId, person.id)).toBe("active");
    const listed = await request(communityApi, offersPath(communityId), { userId: person.id });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      data: [],
      nextCursor: null,
      waitingForVerification: false,
    });
  });
});
