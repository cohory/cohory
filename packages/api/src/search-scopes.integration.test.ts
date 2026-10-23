import { createAgentsService } from "@cohory/agents";
import { createApprovalsService } from "@cohory/agents/approvals";
import type { UserActor } from "@cohory/authz";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import {
  addMembership,
  createDb,
  createPool,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  withCommunity,
} from "@cohory/db";
import { memberships, users } from "@cohory/db/schema";
import { createApprovalNotifier } from "@cohory/notifications";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { createWebhooksService } from "@cohory/webhooks";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";
import { createPaymentsStub } from "./test/payments-stub";

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
const api = createApi(() =>
  apiDeps({
    resolveSession: async () => null,
    communities,
    posts,
    agents,
    approvals: createApprovalsService({ db, notify: createApprovalNotifier({ db }) }),
    payments: createPaymentsStub(),
    webhooks: createWebhooksService({
      db,
      key: () => Buffer.alloc(32, 7),
      queue: { enqueue: async () => undefined },
    }),
    rateLimiter: createRateLimiter({
      rules: {
        ...rateLimitDefaults,
        apiToken: { max: 10_000, windowSeconds: 60 },
        search: { max: 10_000, windowSeconds: 60 },
      },
    }),
  }),
);

const term = `quokka${newId()
  .slice(-6)
  .replace(/[^a-z]/g, "x")}`;
let slug: string;
let memberId: string;
let readOnlyPosts: string;
let wideToken: string;

function user(userId: string): UserActor {
  return { kind: "user", userId, platformAdmin: false };
}

async function insertUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `scopes-${newId()}@example.test` })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  return row.id;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function get(path: string, token: string) {
  return api.request(`/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  const ownerId = await insertUser("Scope owner");
  const created = await communities.createCommunity(user(ownerId), {
    name: "Scopes",
    slug: `scopes-${newId().slice(-12)}`,
  });
  slug = created.community.slug;
  const communityId = parseCommunityId(created.community.id);
  memberId = await insertUser("Scope member");
  await addMembership(withCommunity(db, communityId), {
    userId: memberId,
    role: "member",
    status: "active",
    joinedAt: new Date(),
  });
  await db
    .update(memberships)
    .set({ bio: `I keep a ${term} at home` })
    .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, memberId)));
  const post = await posts.createPost(user(memberId), communityId, {
    title: `About the ${term}`,
    body: body("Notes"),
  });
  const quiet = await posts.createPost(user(ownerId), communityId, { body: body("Studio") });
  await posts.createComment(user(memberId), communityId, quiet.post.id, {
    body: body(`Has anyone seen the ${term}?`),
  });
  expect(post.post.id).toBeDefined();
  readOnlyPosts = (
    await agents.createPersonalToken(user(ownerId), {
      communityId,
      name: "Posts only",
      scopes: ["community:read", "posts:read"],
    })
  ).token;
  wideToken = (
    await agents.createPersonalToken(user(ownerId), {
      communityId,
      name: "Wide",
      scopes: ["community:read", "posts:read", "comments:read", "members:read"],
    })
  ).token;
});

afterAll(async () => {
  await pool.end();
});

interface SearchBody {
  posts: { commentId: string | null }[];
  members: { userId: string }[];
  lessons: unknown[];
}

interface ProfileBody {
  recentActivity: { posts: unknown[]; comments: unknown[] };
}

describe("token scopes on composite reads", () => {
  it("searches only the groups the token's scopes cover", async () => {
    const limited = await get(`/communities/${slug}/search?q=${term}`, readOnlyPosts);
    expect(limited.status).toBe(200);
    const limitedBody = (await limited.json()) as SearchBody;
    expect(limitedBody.members).toEqual([]);
    expect(limitedBody.posts.length).toBeGreaterThan(0);
    expect(limitedBody.posts.every((hit) => hit.commentId === null)).toBe(true);

    const wide = (await (
      await get(`/communities/${slug}/search?q=${term}`, wideToken)
    ).json()) as SearchBody;
    expect(wide.members.map((hit) => hit.userId)).toEqual([memberId]);
    expect(wide.posts.some((hit) => hit.commentId !== null)).toBe(true);
  });

  it("shows recent posts and comments on a profile only with the matching scopes", async () => {
    const membersOnly = (
      await agents.createPersonalToken(user(memberId), {
        communityId: parseCommunityId(
          (await communities.getCommunityBySlug(user(memberId), slug)).id,
        ),
        name: "Members only",
        scopes: ["community:read", "members:read"],
      })
    ).token;
    const limited = await get(`/communities/${slug}/members/${memberId}`, membersOnly);
    expect(limited.status).toBe(200);
    expect(((await limited.json()) as ProfileBody).recentActivity).toEqual({
      posts: [],
      comments: [],
    });

    const wide = (await (
      await get(`/communities/${slug}/members/${memberId}`, wideToken)
    ).json()) as ProfileBody;
    expect(wide.recentActivity.posts.length).toBeGreaterThan(0);
    expect(wide.recentActivity.comments.length).toBeGreaterThan(0);
  });
});
