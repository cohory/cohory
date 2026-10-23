import { describe, expect, it, vi } from "vitest";

import { createVideoThumbnailResolver, type ThumbnailFetch } from "./video-thumbnail";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createVideoThumbnailResolver", () => {
  it("builds YouTube thumbnails without a network request", async () => {
    const fetch = vi.fn<ThumbnailFetch>();
    const resolve = createVideoThumbnailResolver({ fetch });

    await expect(resolve("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).resolves.toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the Vimeo thumbnail from its oEmbed endpoint without following redirects", async () => {
    const fetch = vi.fn<ThumbnailFetch>(async () =>
      json({ thumbnail_url: "https://i.vimeocdn.com/video/452001751-d_640" }),
    );
    const resolve = createVideoThumbnailResolver({ fetch });

    await expect(resolve("https://player.vimeo.com/video/76979871")).resolves.toBe(
      "https://i.vimeocdn.com/video/452001751-d_640",
    );
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads the Loom thumbnail from its oEmbed endpoint", async () => {
    const fetch = vi.fn<ThumbnailFetch>(async () =>
      json({ thumbnail_url: "https://cdn.loom.com/sessions/thumbnails/abc-with-play.gif" }),
    );
    const resolve = createVideoThumbnailResolver({ fetch });

    await expect(resolve("https://www.loom.com/embed/0123456789abcdef")).resolves.toBe(
      "https://cdn.loom.com/sessions/thumbnails/abc-with-play.gif",
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://www.loom.com/v1/oembed?url=https%3A%2F%2Fwww.loom.com%2Fshare%2F0123456789abcdef",
    );
  });

  it("drops thumbnails served from any other host", async () => {
    const fetch = vi.fn<ThumbnailFetch>(async () =>
      json({ thumbnail_url: "https://tracker.example/pixel.gif" }),
    );
    const resolve = createVideoThumbnailResolver({ fetch });

    await expect(resolve("https://player.vimeo.com/video/76979871")).resolves.toBeNull();
  });

  it("falls back when the endpoint fails, times out, or answers with junk", async () => {
    const failing = [
      vi.fn<ThumbnailFetch>(async () => json({ error: "not found" }, 404)),
      vi.fn<ThumbnailFetch>(async () => new Response("<html>")),
      vi.fn<ThumbnailFetch>(async () => {
        throw new TypeError("redirect mode is set to error");
      }),
      vi.fn<ThumbnailFetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    ];
    for (const fetch of failing) {
      const resolve = createVideoThumbnailResolver({ fetch, timeoutMs: 20 });
      await expect(resolve("https://www.loom.com/embed/0123456789abcdef")).resolves.toBeNull();
    }
  });

  it("ignores URLs that are not normalized embed URLs", async () => {
    const fetch = vi.fn<ThumbnailFetch>();
    const resolve = createVideoThumbnailResolver({ fetch });

    await expect(resolve("https://evil.example/video/1")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
