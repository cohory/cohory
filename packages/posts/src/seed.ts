import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, type CommunitySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devPaidSeed, devSeed } from "@cohory/db/seed";
import { inArray } from "drizzle-orm";

import { createPostgresPostsRepository } from "./postgres-repository";
import {
  creatorsCategories,
  creatorsPosts,
  doc,
  proCategories,
  proPosts,
  type SeedCategory,
  type SeedPost,
} from "./seed-content";
import { createPostsService, type PostsService } from "./service";

export interface PostsSeedResult {
  categoriesCreated: number;
  postsCreated: number;
  commentsCreated: number;
}

function seedPostsService(db: Database): PostsService {
  return createPostsService({
    repo: createPostgresPostsRepository(db),
    storage: {
      put: () => Promise.reject(new Error("the posts seed does not upload files")),
      publicUrl: (key) => `/api/uploads/${key}`,
    },
  });
}

function actorFor(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

async function seedCommunityPosts(
  db: Database,
  slug: CommunitySlug,
  categories: readonly SeedCategory[],
  posts: readonly SeedPost[],
): Promise<PostsSeedResult> {
  const community = await getCommunityBySlug(db, slug);
  const emails = [...new Set(posts.flatMap(authorsOf))];
  const people = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, [devSeed.email, ...emails]));
  const actorOf = (email: string): Actor => {
    const person = people.find((row) => row.email === email);
    if (!person) {
      throw new Error(`run the base seed before seeding posts: ${email} is missing`);
    }
    return actorFor(person.id);
  };
  if (!community) {
    throw new Error("run the base seed before seeding posts");
  }
  const service = seedPostsService(db);
  const owner = actorOf(devSeed.email);

  let categoriesCreated = 0;
  let existingCategories = await service.listCategories(owner, community.id);
  if (existingCategories.length === 0) {
    for (const category of categories) {
      await service.createCategory(owner, community.id, category);
      categoriesCreated += 1;
    }
    existingCategories = await service.listCategories(owner, community.id);
  }
  const categoryId = (name: string) => existingCategories.find((c) => c.name === name)?.id ?? null;

  const existing = await service.listFeed(owner, community.id, { limit: 1 });
  if (existing.data.length > 0) {
    return { categoriesCreated, postsCreated: 0, commentsCreated: 0 };
  }
  let commentsCreated = 0;
  for (const post of posts) {
    const created = await service.createPost(actorOf(post.author), community.id, {
      title: post.title,
      body: post.body,
      categoryId: categoryId(post.category),
    });
    if (post.pinned) {
      await service.pinPost(owner, community.id, created.post.id);
    }
    for (const comment of post.comments ?? []) {
      const parent = await service.createComment(
        actorOf(comment.author),
        community.id,
        created.post.id,
        { body: doc(comment.text) },
      );
      commentsCreated += 1;
      for (const reply of comment.replies ?? []) {
        await service.createComment(actorOf(reply.author), community.id, created.post.id, {
          body: doc(reply.text),
          parentId: parent.comment.id,
        });
        commentsCreated += 1;
      }
    }
  }
  return { categoriesCreated, postsCreated: posts.length, commentsCreated };
}

function authorsOf(post: SeedPost): string[] {
  return [
    post.author,
    ...(post.comments ?? []).flatMap((comment) => [
      comment.author,
      ...(comment.replies ?? []).map((reply) => reply.author),
    ]),
  ];
}

export function seedDevPosts(db: Database): Promise<PostsSeedResult> {
  return seedCommunityPosts(db, devSeed.communitySlug, creatorsCategories, creatorsPosts);
}

export function seedDevPaidPosts(db: Database): Promise<PostsSeedResult> {
  return seedCommunityPosts(db, devPaidSeed.communitySlug, proCategories, proPosts);
}
