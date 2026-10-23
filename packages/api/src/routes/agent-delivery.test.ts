import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import { communitySlugSchema } from "@cohory/db";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { describe, expect, it } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import { createStub } from "../test/courses-stub";

function apiWith(limit: number) {
  const repo = createFakeRepository();
  repo.addCommunity({ slug: communitySlugSchema.parse("makers"), privacy: "private" });
  const courses = createStub();
  courses.openAgentDownload.mockResolvedValue({
    name: "skill.zip",
    mediaType: "application/zip",
    sha256: "c".repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
  });
  const rateLimiter = createRateLimiter({
    rules: { ...rateLimitDefaults, agentDownload: { max: limit, windowSeconds: 60 } },
    disabled: false,
  });
  const api = createApi(() =>
    apiDeps({
      resolveSession: async () => null,
      communities: createCommunitiesService(repo),
      posts: createPostsService({
        repo: createFakePostsRepository(),
        storage: {
          put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
          publicUrl: (k) => k,
        },
      }),
      courses,
      rateLimiter,
    }),
  );
  return { api, courses };
}

async function download(api: ReturnType<typeof createApi>, address: string): Promise<Response> {
  return api.request("/api/v1/communities/makers/agent-downloads/signed-token-1", {
    headers: { "x-forwarded-for": address },
  });
}

describe("signed download links", () => {
  it("are rate limited per client address and answer 429 with Retry-After", async () => {
    const { api, courses } = apiWith(2);

    expect((await download(api, "198.51.100.1")).status).toBe(200);
    expect((await download(api, "198.51.100.1")).status).toBe(200);
    const limited = await download(api, "198.51.100.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
    expect((await download(api, "198.51.100.2")).status).toBe(200);
    expect(courses.openAgentDownload).toHaveBeenCalledTimes(3);
  });
});
