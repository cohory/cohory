import type { Actor, CommunityRole, Scope } from "@cohory/authz";
import { createCoursesService, createPostgresCoursesRepository } from "@cohory/courses";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { courseModules, courses, lessons, memberships, users } from "@cohory/db/schema";
import { createMembersService, createPostgresMembersRepository } from "@cohory/members";
import {
  createPostgresPostsRepository,
  createPostsService,
  PostsCommunityNotFoundError,
} from "@cohory/posts";
import { ForbiddenError } from "@cohory/authz";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSearchService, type SearchResults } from "./service";

const probeRole = "cohory_search_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const admin = createDb(adminPool);
const probeUrl = new URL(adminUrl);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probe = createDb(probePool);

let clock = Date.UTC(2026, 9, 1);
const posts = createPostsService({
  repo: createPostgresPostsRepository(probe),
  storage: {
    put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
    publicUrl: (key) => `/files/${key}`,
  },
  now: () => new Date((clock += 1000)),
});
const search = createSearchService({
  posts,
  courses: createCoursesService({
    repo: createPostgresCoursesRepository(probe),
    storage: {
      put: async (input) => ({ key: input.key, contentType: "image/png", size: 0 }),
      get: async () => null,
    },
  }),
  members: createMembersService(createPostgresMembersRepository(probe)),
});

type UserActor = Extract<Actor, { kind: "user" }>;

async function newUser(name: string): Promise<UserActor> {
  const [row] = await admin
    .insert(users)
    .values({ name, email: `search-${newId()}@example.test`, username: `s${newId().slice(-10)}` })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return { kind: "user", userId: row.id, platformAdmin: false };
}

async function newCommunity(privacy: "public" | "private"): Promise<CommunityId> {
  const community = await createCommunity(admin, {
    slug: communitySlugSchema.parse(`search-${newId().slice(-12)}`),
    name: "Search",
    privacy,
  });
  return community.id;
}

async function join(
  communityId: CommunityId,
  name: string,
  role: CommunityRole = "member",
  bio: string | null = null,
): Promise<UserActor> {
  const actor = await newUser(name);
  await addMembership(withCommunity(admin, communityId), {
    userId: actor.userId,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  if (bio) {
    await admin
      .update(memberships)
      .set({ bio })
      .where(and(eq(memberships.communityId, communityId), eq(memberships.userId, actor.userId)));
  }
  return actor;
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function lesson(
  communityId: CommunityId,
  title: string,
  courseStatus: "draft" | "published",
  lessonStatus: "draft" | "published",
): Promise<void> {
  const [course] = await admin
    .insert(courses)
    .values({
      communityId,
      slug: `course-${newId().slice(-8)}`,
      title: `${title} course`,
      status: courseStatus,
      position: 0,
    })
    .returning({ id: courses.id });
  if (!course) throw new Error("course insert returned no row");
  const [module] = await admin
    .insert(courseModules)
    .values({ communityId, courseId: course.id, title: "Module", position: 0 })
    .returning({ id: courseModules.id });
  if (!module) throw new Error("module insert returned no row");
  await admin.insert(lessons).values({
    communityId,
    courseId: course.id,
    moduleId: module.id,
    slug: `lesson-${newId().slice(-8)}`,
    title,
    bodyMarkdown: "Throw the clay and keep the wheel slow.",
    status: lessonStatus,
    position: 0,
  });
}

let communityA: CommunityId;
let communityB: CommunityId;
let publicCommunity: CommunityId;
let owner: UserActor;
let member: UserActor;
let outsider: UserActor;
let ownerB: UserActor;
let publicOwner: UserActor;
let titled: string;
let bodyOnly: string;

beforeAll(async () => {
  await admin.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant usage on schema public to ${probeRole};
    grant select, insert, update, delete on all tables in schema public to ${probeRole};
  `),
  );
  communityA = await newCommunity("private");
  communityB = await newCommunity("private");
  publicCommunity = await newCommunity("public");
  owner = await join(communityA, "Olga Owner", "owner");
  member = await join(communityA, "Mia Member", "member", "I glaze stoneware on weekends");
  outsider = await newUser("Otto Outsider");
  ownerB = await join(communityB, "Bea Glazer", "owner", "Glaze chemistry");
  publicOwner = await join(publicCommunity, "Pia Public", "owner");

  titled = (
    await posts.createPost(owner, communityA, {
      title: "Glaze recipes",
      body: body("A few notes for the kiln."),
    })
  ).post.id;
  bodyOnly = (
    await posts.createPost(member, communityA, {
      title: "Weekend",
      body: body("I tried a new glaze and it cracked."),
    })
  ).post.id;
  const deleted = await posts.createPost(member, communityA, { body: body("Secret glaze") });
  await posts.deletePost(member, communityA, deleted.post.id);
  const quiet = await posts.createPost(owner, communityA, { body: body("Studio hours") });
  await posts.createComment(member, communityA, quiet.post.id, {
    body: body("Is the glaze room open?"),
  });
  await posts.createPost(ownerB, communityB, { title: "Glaze elsewhere", body: body("Other") });

  await lesson(communityA, "Glaze basics", "published", "published");
  await lesson(communityA, "Glaze draft", "published", "draft");
  await lesson(communityA, "Glaze hidden course", "draft", "published");
  await lesson(communityB, "Glaze in B", "published", "published");
});

afterAll(async () => {
  await probePool.end();
  await adminPool.end();
});

function postIds(results: SearchResults): string[] {
  return results.posts.map((hit) => hit.postId);
}

describe("community search in Postgres as a non bypass role", () => {
  it("finds posts, comments, published lessons, and members of this community only", async () => {
    const results = await search.search(member, communityA, { query: "glaz" }, member.userId);

    expect(results.posts).toHaveLength(3);
    expect(postIds(results)).toEqual(expect.arrayContaining([titled, bodyOnly]));
    expect(results.posts.find((hit) => hit.commentId !== null)?.excerpt).toContainEqual({
      text: "glaze",
      match: true,
    });
    expect(results.posts.every((hit) => !hit.title?.includes("elsewhere"))).toBe(true);
    expect(results.lessons.map((hit) => hit.lessonTitle)).toEqual(["Glaze basics"]);
    expect(results.members.map((hit) => hit.name)).toEqual(["Mia Member"]);
    expect(results.members[0]?.bioExcerpt).toContainEqual({ text: "glaze", match: true });
  });

  it("leaves out the groups a token's scopes do not cover", async () => {
    const onlyPosts = (scope: Scope) => scope === "posts:read";
    const limited = await search.search(
      member,
      communityA,
      { query: "glaz" },
      member.userId,
      onlyPosts,
    );

    expect(limited.members).toEqual([]);
    expect(limited.lessons).toEqual([]);
    expect(limited.posts.length).toBeGreaterThan(0);
    expect(limited.posts.every((hit) => hit.commentId === null)).toBe(true);

    const everything = await search.search(
      member,
      communityA,
      { query: "glaz" },
      member.userId,
      (scope) => ["posts:read", "comments:read", "members:read", "courses:read"].includes(scope),
    );
    expect(everything.members.map((hit) => hit.name)).toEqual(["Mia Member"]);
    expect(everything.lessons.map((hit) => hit.lessonTitle)).toEqual(["Glaze basics"]);
    expect(everything.posts.some((hit) => hit.commentId !== null)).toBe(true);
  });

  it("ranks a title match above a body only match", async () => {
    const results = await search.search(member, communityA, { query: "glaze" }, member.userId);

    expect(postIds(results).indexOf(titled)).toBeLessThan(postIds(results).indexOf(bodyOnly));
  });

  it("matches every word of the query", async () => {
    const results = await search.search(
      member,
      communityA,
      { query: "glaze cracked" },
      member.userId,
    );

    expect(postIds(results)).toEqual([bodyOnly]);
  });

  it("refuses an outsider in a private community", async () => {
    await expect(
      search.search(outsider, communityA, { query: "glaze" }, outsider.userId),
    ).rejects.toSatisfy(
      (error) => error instanceof ForbiddenError || error instanceof PostsCommunityNotFoundError,
    );
  });

  it("keeps a member of another private community out, and keeps their own results inside their community", async () => {
    await expect(
      search.search(ownerB, communityA, { query: "glaze" }, ownerB.userId),
    ).rejects.toSatisfy(
      (error) => error instanceof ForbiddenError || error instanceof PostsCommunityNotFoundError,
    );

    const theirs = await search.search(ownerB, communityB, { query: "glaze" }, ownerB.userId);

    expect(theirs.posts.map((hit) => hit.title)).toEqual(["Glaze elsewhere"]);
    expect(theirs.lessons.map((hit) => hit.lessonTitle)).toEqual(["Glaze in B"]);
    expect(theirs.members.map((hit) => hit.name)).toEqual(["Bea Glazer"]);
    expect(theirs.posts.some((hit) => [titled, bodyOnly].includes(hit.postId))).toBe(false);
  });

  it("lets a guest search the posts of a public community but not its members or lessons", async () => {
    await posts.createPost(publicOwner, publicCommunity, { body: body("Open glaze night") });

    const results = await search.search(
      { kind: "guest" },
      publicCommunity,
      { query: "glaze" },
      "ip",
    );

    expect(results.posts).toHaveLength(1);
    expect(results.members).toEqual([]);
    expect(results.lessons).toEqual([]);
  });
});
