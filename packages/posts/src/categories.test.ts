import { ForbiddenError, type Actor, type CommunityRole } from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { CategoryLimitError, CategoryNotFoundError, PostValidationError } from "./errors";
import { createPostsService, type PostsService } from "./service";
import { categorySlug, freeSlug } from "./service/categories";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

let repo: FakePostsRepository;
let service: PostsService;
let communityId: string;
let clock: number;

function member(role: CommunityRole = "member", inCommunity = communityId): Actor {
  const userId = newId();
  repo.addMember(inCommunity, userId, role);
  repo.addUser(userId, `${role} person`);
  return { kind: "user", userId, platformAdmin: false };
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

beforeEach(() => {
  repo = createFakePostsRepository();
  clock = Date.UTC(2026, 9, 1);
  service = createPostsService({
    repo,
    storage: {
      async put(input) {
        return { key: input.key, contentType: "image/png", size: input.body.byteLength };
      },
      publicUrl: (key) => `/files/${key}`,
    },
    now: () => new Date((clock += 1000)),
  });
  communityId = repo.addCommunity(newId(), "private").id;
});

describe("category slugs", () => {
  it("builds lowercase ASCII slugs and avoids taken ones", () => {
    expect(categorySlug("  Café & Crème Brûlée ")).toBe("cafe-creme-brulee");
    expect(categorySlug("!!!")).toBe("category");
    expect(freeSlug("General", new Set(["general", "general-2"]))).toBe("general-3");
  });
});

describe("managing categories", () => {
  it.each(["admin", "owner"] as const)(
    "lets a %s create, rename, reorder, and delete",
    async (role) => {
      const manager = member(role);

      const general = await service.createCategory(manager, communityId, { name: "General" });
      const news = await service.createCategory(manager, communityId, {
        name: "News",
        color: "info",
        staffOnly: true,
      });
      const renamed = await service.updateCategory(manager, communityId, news.id, {
        name: "Announcements",
      });
      const reordered = await service.reorderCategories(manager, communityId, {
        ids: [news.id, general.id],
      });

      expect(general).toMatchObject({ slug: "general", color: "neutral", position: 0 });
      expect(renamed).toMatchObject({ slug: "announcements", color: "info", staffOnly: true });
      expect(reordered.map((c) => c.id)).toEqual([news.id, general.id]);
      await service.deleteCategory(manager, communityId, general.id);
      expect((await service.listCategories(manager, communityId)).map((c) => c.id)).toEqual([
        news.id,
      ]);
    },
  );

  it.each(["moderator", "member"] as const)("refuses a %s", async (role) => {
    await expect(
      service.createCategory(member(role), communityId, { name: "General" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gives a duplicate name its own slug and stops at ten categories", async () => {
    const owner = member("owner");
    for (let index = 0; index < 10; index += 1) {
      await service.createCategory(owner, communityId, { name: "Topic" });
    }

    const slugs = (await service.listCategories(owner, communityId)).map((c) => c.slug);

    expect(new Set(slugs).size).toBe(10);
    expect(slugs).toContain("topic-10");
    await expect(
      service.createCategory(owner, communityId, { name: "One more" }),
    ).rejects.toBeInstanceOf(CategoryLimitError);
  });

  it("refuses an empty or long name", async () => {
    const owner = member("owner");

    await expect(service.createCategory(owner, communityId, { name: " " })).rejects.toBeInstanceOf(
      PostValidationError,
    );
    await expect(
      service.createCategory(owner, communityId, { name: "x".repeat(41) }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });

  it("never touches another community's category", async () => {
    const otherCommunity = repo.addCommunity(newId(), "private").id;
    const theirs = await service.createCategory(member("owner", otherCommunity), otherCommunity, {
      name: "Theirs",
    });

    await expect(
      service.updateCategory(member("owner"), communityId, theirs.id, { name: "Mine" }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(
      service.createPost(member(), communityId, { body: body("Hi"), categoryId: theirs.id }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });
});

describe("posting in categories", () => {
  it("shows the category on the post and filters the feed by its slug", async () => {
    const owner = member("owner");
    const author = member();
    const general = await service.createCategory(owner, communityId, { name: "General" });
    await service.createPost(author, communityId, { body: body("Hello"), categoryId: general.id });
    await service.createPost(author, communityId, { body: body("Loose") });

    const filtered = await service.listFeed(author, communityId, { category: "general" });
    const all = await service.listFeed(author, communityId);

    expect(filtered.data.map((post) => post.excerpt)).toEqual(["Hello"]);
    expect(filtered.data[0]?.category).toEqual({
      id: general.id,
      name: "General",
      slug: "general",
      color: "neutral",
    });
    expect(all.data).toHaveLength(2);
    await expect(
      service.listFeed(author, communityId, { category: "missing" }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("lets only staff post in a staff only category", async () => {
    const owner = member("owner");
    const announcements = await service.createCategory(owner, communityId, {
      name: "Announcements",
      staffOnly: true,
    });
    const regular = member();

    await expect(
      service.createPost(regular, communityId, {
        body: body("Me too"),
        categoryId: announcements.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { post } = await service.createPost(member("moderator"), communityId, {
      body: body("News"),
      categoryId: announcements.id,
    });
    expect(post.category?.slug).toBe("announcements");
    expect((await service.listCategories(regular, communityId))[0]?.canPost).toBe(false);
  });

  it("keeps posts without a category when General itself is deleted", async () => {
    const owner = member("owner");
    const general = await service.createCategory(owner, communityId, { name: "General" });
    const { post } = await service.createPost(owner, communityId, {
      body: body("Stay"),
      categoryId: general.id,
    });

    await service.deleteCategory(owner, communityId, general.id);

    expect((await service.getPost(owner, communityId, post.id)).category).toBeNull();
  });

  it("moves the posts of a deleted category to General", async () => {
    const owner = member("owner");
    const general = await service.createCategory(owner, communityId, { name: "General" });
    const events = await service.createCategory(owner, communityId, { name: "Events" });
    const { post } = await service.createPost(owner, communityId, {
      body: body("Meetup"),
      categoryId: events.id,
    });

    await service.deleteCategory(owner, communityId, events.id);

    expect((await service.getPost(owner, communityId, post.id)).category?.id).toBe(general.id);
  });
});
