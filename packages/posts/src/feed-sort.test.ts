import type { Actor, CommunityRole } from "@cohory/authz";
import { newId } from "@cohory/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PostValidationError } from "./errors";
import { createPostsService, type PostsService } from "./service";
import { createFakePostsRepository, type FakePostsRepository } from "./test/fake-repository";

const dayMs = 24 * 60 * 60 * 1000;

let repo: FakePostsRepository;
let service: PostsService;
let communityId: string;
let clock: number;

function member(role: CommunityRole = "member"): Actor {
  const userId = newId();
  repo.addMember(communityId, userId, role);
  repo.addUser(userId, `${role} person`);
  return { kind: "user", userId, platformAdmin: false };
}

function body(text: string): unknown {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function post(author: Actor, text: string): Promise<string> {
  return (await service.createPost(author, communityId, { body: body(text) })).post.id;
}

async function excerpts(viewer: Actor, sort: "active" | "new" | "top"): Promise<string[]> {
  return (await service.listFeed(viewer, communityId, { sort })).data.map((p) => p.excerpt);
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

describe("feed sort", () => {
  it("orders Newest by creation and Active by the latest comment", async () => {
    const author = member();
    const first = await post(author, "First");
    await post(author, "Second");
    await post(author, "Third");
    await service.createComment(author, communityId, first, { body: body("Bump") });

    expect(await excerpts(author, "new")).toEqual(["Third", "Second", "First"]);
    expect(await excerpts(author, "active")).toEqual(["First", "Third", "Second"]);
  });

  it("defaults to Active", async () => {
    const author = member();
    const first = await post(author, "First");
    await post(author, "Second");
    await service.createComment(author, communityId, first, { body: body("Bump") });

    const feed = await service.listFeed(author, communityId);

    expect(feed.data.map((p) => p.excerpt)).toEqual(["First", "Second"]);
  });

  it("ranks Top by likes plus comments counted twice over the last seven days", async () => {
    const author = member();
    const old = await post(author, "Old");
    clock += 8 * dayMs;
    const liked = await post(author, "Liked");
    const discussed = await post(author, "Discussed");
    await post(author, "Quiet");
    for (const fan of [member(), member(), member()]) {
      await service.toggleLike(fan, communityId, {
        subjectType: "post",
        subjectId: liked,
        liked: true,
      });
      await service.toggleLike(fan, communityId, {
        subjectType: "post",
        subjectId: old,
        liked: true,
      });
    }
    await service.createComment(author, communityId, discussed, { body: body("One") });
    await service.createComment(author, communityId, discussed, { body: body("Two") });

    expect(await excerpts(author, "top")).toEqual(["Discussed", "Liked", "Quiet"]);
  });

  it.each(["active", "new", "top"] as const)("keeps pinned posts on top in %s", async (sort) => {
    const owner = member("owner");
    const pinned = await post(owner, "Pinned");
    await post(owner, "Later");
    await service.pinPost(owner, communityId, pinned);

    expect((await excerpts(owner, sort))[0]).toBe("Pinned");
  });

  it.each(["active", "new", "top"] as const)(
    "pages through %s without repeating or skipping posts",
    async (sort) => {
      const author = member();
      const ids: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        ids.push(await post(author, `Post ${index}`));
      }
      await service.pinPost(member("owner"), communityId, ids[3] ?? "");

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<PostsService["listFeed"]>> = await service.listFeed(
          author,
          communityId,
          { sort, limit: 2, cursor },
        );
        seen.push(...page.data.map((p) => p.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(seen[0]).toBe(ids[3]);
    },
  );

  it("refuses a cursor made for another sort", async () => {
    const author = member();
    await post(author, "One");
    await post(author, "Two");
    const page = await service.listFeed(author, communityId, { sort: "new", limit: 1 });

    await expect(
      service.listFeed(author, communityId, { sort: "top", cursor: page.nextCursor }),
    ).rejects.toBeInstanceOf(PostValidationError);
  });
});
