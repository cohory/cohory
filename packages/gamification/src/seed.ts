import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devAdmin, devCreators, devMember, devSeed } from "@cohory/db/seed";
import { createPostgresPostsRepository, createPostsService, type PostEvent } from "@cohory/posts";
import { inArray } from "drizzle-orm";

import { createGamificationService } from "./service";

export interface GamificationSeedResult {
  likesAdded: number;
  pointsRecorded: number;
}

const [maya, diego, priya, sam] = devCreators;

const likesByTitle: Readonly<Record<string, readonly string[]>> = {
  "Welcome to Cohory Creators: how to give feedback": [devAdmin.email, maya.email, sam.email],
  "Roadmap: now, next, later": [devMember.email, priya.email, diego.email],
  "Shipped this week: Cohory 0.11.0": [devSeed.email, maya.email, priya.email, diego.email],
  "Hi, I'm Maya from Clay at Home": [devSeed.email, devAdmin.email, priya.email, sam.email],
  "Import course content from Skool": [
    devSeed.email,
    devMember.email,
    maya.email,
    diego.email,
    sam.email,
  ],
  "Can members pay yearly?": [maya.email, priya.email],
  "First 10 paying members in one week": [
    devSeed.email,
    devAdmin.email,
    devMember.email,
    diego.email,
    priya.email,
    sam.email,
  ],
  "My old cover loads slowly on phones": [diego.email, devMember.email],
  "Edit one date of a repeating event": [maya.email, diego.email, priya.email],
};

function actor(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

export async function seedDevPoints(db: Database): Promise<GamificationSeedResult> {
  const community = await getCommunityBySlug(db, devSeed.communitySlug);
  const emails = [
    devSeed.email,
    devAdmin.email,
    devMember.email,
    ...devCreators.map((c) => c.email),
  ];
  const people = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, emails));
  if (!community || people.length !== emails.length) {
    throw new Error("run the base and posts seeds before seeding points");
  }
  const idOf = (email: string) => people.find((person) => person.email === email)?.id ?? "";
  const events: PostEvent[] = [];
  const posts = createPostsService({
    repo: createPostgresPostsRepository(db),
    storage: {
      put: () => Promise.reject(new Error("the points seed does not upload files")),
      publicUrl: (key) => `/api/uploads/${key}`,
    },
    onEvents: async (committed) => {
      events.push(...committed.events);
    },
  });
  const feed = await posts.listFeed(actor(idOf(devSeed.email)), community.id, { limit: 50 });
  if (feed.data.length === 0) {
    throw new Error("run the posts seed before seeding points");
  }
  for (const post of feed.data) {
    for (const email of likesByTitle[post.title ?? ""] ?? []) {
      await posts.toggleLike(actor(idOf(email)), community.id, {
        subjectType: "post",
        subjectId: post.id,
        liked: true,
      });
    }
  }
  const liked = events.filter((event) => event.type === "like.added");
  const { inserted } =
    liked.length > 0
      ? await createGamificationService({ db }).recordPostEvents(liked)
      : { inserted: 0 };
  return { likesAdded: liked.length, pointsRecorded: inserted };
}
