import type * as PostsModule from "@cohory/posts";
import { createPostsService, type PostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { describe, expect, it, vi } from "vitest";

function fakePosts(): PostsService {
  return createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
  });
}

const built = vi.hoisted(() => ({ posts: 0 }));

vi.mock("@cohory/posts", async (importOriginal) => {
  const original = await importOriginal<typeof PostsModule>();
  return {
    ...original,
    createDefaultPostsService: () => {
      built.posts += 1;
      return original.createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: String,
        },
      });
    },
  };
});

const { apiDeps, getPostsService } = await import("./services");

describe("apiDeps", () => {
  it("uses an override instead of building the default", () => {
    const posts = fakePosts();
    expect(apiDeps({ posts }).posts).toBe(posts);
    expect(built.posts).toBe(0);
  });

  it("shares one posts service between the API and the web app", () => {
    expect(apiDeps().posts).toBe(getPostsService());
    expect(apiDeps().posts).toBe(apiDeps().posts);
    expect(built.posts).toBe(1);
  });
});
