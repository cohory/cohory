import { signUpWithSession } from "@cohory/auth/testing";
import { createAuth, createAuthOptions } from "@cohory/auth";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import { createDb, createPool, newId, parseDatabaseEnv } from "@cohory/db";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { afterAll, describe, expect, it } from "vitest";
import { apiDeps } from "./services";

import { createApi } from "./app";
import { betterAuthSessionResolver } from "./middleware/session";

const baseURL = "http://localhost:3000";
const pool = createPool(parseDatabaseEnv().DATABASE_URL);
const db = createDb(pool);
const auth = createAuth(
  createAuthOptions(
    db,
    {
      BETTER_AUTH_SECRET: "integration-secret-that-is-at-least-32-chars",
      BETTER_AUTH_URL: baseURL,
    },
    { send: async () => undefined },
  ),
);
const api = createApi(() =>
  apiDeps({
    resolveSession: betterAuthSessionResolver(auth),
    communities: createCommunitiesService(createPostgresCommunitiesRepository(db)),
    posts: createPostsService({
      repo: createPostgresPostsRepository(db),
      storage: {
        put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
        publicUrl: (key) => key,
      },
    }),
  }),
);

afterAll(async () => {
  await pool.end();
});

async function signUp(): Promise<string> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `creator-${newId()}@example.test`,
        password: "correct horse battery staple",
        name: "Creator",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("sign up returned no session cookie");
  }
  return cookie;
}

async function post(path: string, cookie: string, payload: unknown): Promise<Response> {
  return api.request(`/api/v1/communities${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  });
}

function doc(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe("posts API with a real Better Auth session and Postgres", () => {
  it("creates a post, comments, likes, and keeps the feed private", async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const slug = `posts-${newId().slice(-12)}`;
    expect((await post("", owner, { name: "Posts", slug })).status).toBe(201);

    const created = await post(`/${slug}/posts`, owner, { title: "Welcome", body: doc("Hello") });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const comment = await post(`/${slug}/posts/${id}/comments`, owner, { body: doc("First") });
    expect(comment.status).toBe(201);
    const liked = await post(`/${slug}/posts/${id}/like`, owner, {});
    expect(await liked.json()).toEqual({ liked: true, likeCount: 1 });

    const feed = await api.request(`/api/v1/communities/${slug}/posts`, {
      headers: { cookie: owner },
    });
    expect(feed.status).toBe(200);
    expect(await feed.json()).toMatchObject({
      data: [{ id, title: "Welcome", likeCount: 1, commentCount: 1, viewerHasLiked: true }],
      nextCursor: null,
    });

    const asStranger = await api.request(`/api/v1/communities/${slug}/posts`, {
      headers: { cookie: stranger },
    });
    expect(asStranger.status).toBe(403);
    const asGuest = await api.request(`/api/v1/communities/${slug}/posts/${id}`);
    expect(asGuest.status).toBe(403);
    const strangerPost = await post(`/${slug}/posts`, stranger, { body: doc("Let me in") });
    expect(strangerPost.status).toBe(403);
  });
});
