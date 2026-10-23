import { signUpWithSession } from "@cohory/auth/testing";
import { createAuth, createAuthOptions } from "@cohory/auth";
import { createCommunitiesService, createPostgresCommunitiesRepository } from "@cohory/communities";
import { createCoursesService, createPostgresCoursesRepository } from "@cohory/courses";
import {
  addMembership,
  createDb,
  createPool,
  newId,
  parseCommunityId,
  parseDatabaseEnv,
  runInCommunity,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { memberStats } from "@cohory/db/schema";
import { createPostgresPostsRepository, createPostsService } from "@cohory/posts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    courses: createCoursesService({
      repo: createPostgresCoursesRepository(db),
      storage: {
        put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
        get: async () => null,
      },
    }),
  }),
);

interface Person {
  readonly cookie: string;
  readonly userId: string;
}

interface CourseJson {
  readonly slug: string;
  readonly requiredLevel: number | null;
  readonly locked: boolean;
  readonly modules: readonly { readonly lessons: readonly unknown[] }[];
}

let owner: Person;
let slug: string;
let communityId: CommunityId;
let courseSlug: string;

afterAll(async () => {
  await pool.end();
});

async function signUp(name: string): Promise<Person> {
  const response = await signUpWithSession(
    auth.handler,
    new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({
        email: `course-levels-${newId()}@example.test`,
        password: "correct horse battery staple",
        name,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  const body = (await response.json()) as { user: { id: string } };
  if (!cookie) throw new Error("no session cookie");
  return { cookie, userId: body.user.id };
}

function call(path: string, cookie: string, method = "GET", body?: unknown): Promise<Response> {
  return Promise.resolve(
    api.request(`/api/v1/communities${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function json<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function memberAtLevel(level: number): Promise<Person> {
  const person = await signUp("Learner");
  const scope = withCommunity(db, communityId);
  await addMembership(scope, { userId: person.userId, role: "member", status: "active" });
  await runInCommunity(scope, ({ tx, values }) =>
    tx
      .insert(memberStats)
      .values(values({ userId: person.userId, pointsTotal: 100, level, updatedAt: new Date() })),
  );
  return person;
}

beforeAll(async () => {
  owner = await signUp("Owner");
  slug = `levels-${newId().slice(-12)}`;
  const created = await json<{ community: { id: string } }>(
    await call("", owner.cookie, "POST", { name: "Levels", slug }),
    201,
  );
  communityId = parseCommunityId(created.community.id);
  courseSlug = (
    await json<{ slug: string }>(
      await call(`/${slug}/courses`, owner.cookie, "POST", { title: "Advanced" }),
      201,
    )
  ).slug;
  const module = await json<{ id: string }>(
    await call(`/${slug}/courses/${courseSlug}/modules`, owner.cookie, "POST", { title: "One" }),
    201,
  );
  const lesson = await json<{ id: string }>(
    await call(
      `/${slug}/courses/${courseSlug}/modules/${module.id}/lessons`,
      owner.cookie,
      "POST",
      {
        title: "First",
      },
    ),
    201,
  );
  await json(await call(`/${slug}/lessons/${lesson.id}/publish`, owner.cookie, "POST"), 200);
  await json(await call(`/${slug}/courses/${courseSlug}/publish`, owner.cookie, "POST"), 200);
});

describe("courses locked until a level over REST", () => {
  it("lets the creator set the required level through the course update", async () => {
    const updated = await json<CourseJson>(
      await call(`/${slug}/courses/${courseSlug}`, owner.cookie, "PATCH", { requiredLevel: 3 }),
      200,
    );

    expect(updated).toMatchObject({ requiredLevel: 3, locked: false });
  });

  it("refuses a required level outside 1 to 9", async () => {
    const response = await call(`/${slug}/courses/${courseSlug}`, owner.cookie, "PATCH", {
      requiredLevel: 10,
    });

    expect(response.status).toBe(422);
  });

  it("shows a member below the level a locked course without lessons", async () => {
    await call(`/${slug}/courses/${courseSlug}`, owner.cookie, "PATCH", { requiredLevel: 3 });
    const learner = await memberAtLevel(2);

    const detail = await json<CourseJson>(
      await call(`/${slug}/courses/${courseSlug}`, learner.cookie),
      200,
    );
    const list = await json<{ data: CourseJson[] }>(
      await call(`/${slug}/courses`, learner.cookie),
      200,
    );

    expect(detail).toMatchObject({ requiredLevel: 3, locked: true, modules: [] });
    expect(list.data[0]).toMatchObject({ requiredLevel: 3, locked: true });
  });

  it("gives a member at the level the lessons", async () => {
    await call(`/${slug}/courses/${courseSlug}`, owner.cookie, "PATCH", { requiredLevel: 3 });
    const learner = await memberAtLevel(3);

    const detail = await json<CourseJson>(
      await call(`/${slug}/courses/${courseSlug}`, learner.cookie),
      200,
    );

    expect(detail.locked).toBe(false);
    expect(detail.modules[0]?.lessons).toHaveLength(1);
  });
});
