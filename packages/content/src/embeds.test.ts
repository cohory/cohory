import { describe, expect, it } from "vitest";

import {
  isVideoThumbnailUrl,
  normalizeVideoLink,
  videoIdOfEmbedUrl,
  videoOembedUrl,
  videoPlayerUrl,
  videoProviderOfEmbedUrl,
  videoPosterUrls,
  youtubePosterUrls,
  youtubeThumbnailUrl,
} from "./embeds";

describe("normalizeVideoLink", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ?t=10",
      "youtube",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "youtube",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    ["https://vimeo.com/76979871", "vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://player.vimeo.com/video/76979871", "vimeo", "https://player.vimeo.com/video/76979871"],
    [
      "https://www.loom.com/share/0123456789abcdef",
      "loom",
      "https://www.loom.com/embed/0123456789abcdef",
    ],
  ])("turns %s into the %s embed URL", (raw, provider, embedUrl) => {
    expect(normalizeVideoLink(raw)).toEqual({ provider, embedUrl });
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://fast.wistia.net/embed/iframe/abcdef1234",
    "https://vimeo.com/channels/staffpicks",
    "https://www.youtube.com/watch?v=<script>",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (raw) => {
    expect(normalizeVideoLink(raw)).toBeNull();
  });
});

describe("videoProviderOfEmbedUrl", () => {
  it("names the provider of a normalized embed URL", () => {
    expect(videoProviderOfEmbedUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(
      "youtube",
    );
    expect(videoProviderOfEmbedUrl("https://player.vimeo.com/video/76979871")).toBe("vimeo");
    expect(videoProviderOfEmbedUrl("https://www.loom.com/embed/0123456789abcdef")).toBe("loom");
  });

  it("returns null for anything that is not a normalized embed URL", () => {
    expect(videoProviderOfEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoProviderOfEmbedUrl("https://www.loom.com/embed/a/b")).toBeNull();
  });
});

describe("videoPlayerUrl", () => {
  it("autoplays YouTube muted and inline on the privacy enhanced host", () => {
    expect(
      videoPlayerUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "muted-autoplay"),
    ).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1");
  });

  it("autoplays Vimeo muted with do not track", () => {
    const url = videoPlayerUrl("https://player.vimeo.com/video/76979871", "muted-autoplay");
    expect(url).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1&muted=1&playsinline=1&dnt=1",
    );
  });

  it("autoplays Loom with its documented autoplay and muted parameters", () => {
    expect(videoPlayerUrl("https://www.loom.com/embed/0123456789abcdef", "muted-autoplay")).toBe(
      "https://www.loom.com/embed/0123456789abcdef?autoplay=1&muted=1",
    );
  });

  it("starts with sound after a click and keeps Vimeo do not track", () => {
    expect(videoPlayerUrl("https://player.vimeo.com/video/76979871", "on-click")).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1&playsinline=1&dnt=1",
    );
    expect(
      videoPlayerUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "on-click"),
    ).not.toContain("mute=1");
  });

  it("refuses URLs that are not normalized embed URLs", () => {
    expect(videoPlayerUrl("https://www.youtube.com/embed/dQw4w9WgXcQ", "on-click")).toBeNull();
    expect(videoPlayerUrl("https://evil.example/embed/dQw4w9WgXcQ", "muted-autoplay")).toBeNull();
  });
});

describe("video thumbnails", () => {
  it("builds the YouTube thumbnail from the video id", () => {
    const video = videoIdOfEmbedUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(video).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("tries the sharpest YouTube poster first and falls back to smaller ones", () => {
    expect(youtubePosterUrls("dQw4w9WgXcQ")).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });

  it("derives YouTube posters from the embed and keeps a stored poster for other providers", () => {
    expect(
      videoPosterUrls(
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      ),
    ).toEqual(youtubePosterUrls("dQw4w9WgXcQ"));
    expect(
      videoPosterUrls("https://player.vimeo.com/video/76979871", "https://i.vimeocdn.com/v/1"),
    ).toEqual(["https://i.vimeocdn.com/v/1"]);
    expect(videoPosterUrls("https://player.vimeo.com/video/76979871", null)).toEqual([]);
  });

  it("points Vimeo and Loom at their public oEmbed endpoints only", () => {
    expect(videoOembedUrl({ provider: "vimeo", id: "76979871" })).toBe(
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871",
    );
    expect(videoOembedUrl({ provider: "loom", id: "0123456789abcdef" })).toBe(
      "https://www.loom.com/v1/oembed?url=https%3A%2F%2Fwww.loom.com%2Fshare%2F0123456789abcdef",
    );
    expect(videoOembedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBeNull();
  });

  it("accepts thumbnails only from the provider's image host over https", () => {
    expect(isVideoThumbnailUrl("vimeo", "https://i.vimeocdn.com/video/1-d_640")).toBe(true);
    expect(isVideoThumbnailUrl("loom", "https://cdn.loom.com/sessions/thumbnails/a.gif")).toBe(
      true,
    );
    expect(isVideoThumbnailUrl("vimeo", "https://cdn.loom.com/a.gif")).toBe(false);
    expect(isVideoThumbnailUrl("vimeo", "http://i.vimeocdn.com/video/1")).toBe(false);
    expect(isVideoThumbnailUrl("vimeo", "https://i.vimeocdn.com.evil.example/1")).toBe(false);
    expect(isVideoThumbnailUrl("loom", "javascript:alert(1)")).toBe(false);
  });
});
