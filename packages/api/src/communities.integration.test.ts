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

describe("communities API with a real Better Auth session", () => {
  it("creates a community for the signed up person and reads it back", async () => {
    const cookie = await signUp();
    const slug = `real-${newId().slice(-12)}`;

    const created = await api.request("/api/v1/communities", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Real Session", slug }),
    });
    expect(created.status).toBe(201);

    const asOwner = await api.request(`/api/v1/communities/${slug}`, { headers: { cookie } });
    expect(asOwner.status).toBe(200);
    expect(await asOwner.json()).toMatchObject({
      access: "full",
      slug,
      name: "Real Session",
      privacy: "private",
    });

    const membership = await api.request(`/api/v1/communities/${slug}/membership`, {
      headers: { cookie },
    });
    expect(await membership.json()).toMatchObject({ membership: { role: "owner" } });

    const asGuest = await api.request(`/api/v1/communities/${slug}`);
    expect(asGuest.status).toBe(200);
    expect(await asGuest.json()).toMatchObject({ access: "limited", memberCount: 1 });

    const unknown = await api.request(`/api/v1/communities/missing-${newId().slice(-12)}`);
    expect(unknown.status).toBe(404);
  });

  it("treats an invalid session cookie as a guest", async () => {
    const response = await api.request("/api/v1/communities/me", {
      headers: { cookie: "better-auth.session_token=not-a-real-token" },
    });

    expect(response.status).toBe(401);
  });
});
