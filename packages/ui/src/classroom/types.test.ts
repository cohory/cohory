import { describe, expect, it } from "vitest";

import { formatFileSize, lessonCountLabel, progressLabel, resolveLessonVideo } from "./types";

describe("resolveLessonVideo", () => {
  it("reuses the post embed allowlist", () => {
    expect(resolveLessonVideo("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(resolveLessonVideo("https://vimeo.com/76979871")?.provider).toBe("vimeo");
  });

  it("adds Wistia media and embed links", () => {
    expect(resolveLessonVideo("https://acme.wistia.com/medias/abc123def4")).toMatchObject({
      provider: "wistia",
      src: "https://fast.wistia.net/embed/iframe/abc123def4",
      name: "Wistia",
    });
    expect(resolveLessonVideo("https://fast.wistia.net/embed/iframe/abc123def4")?.id).toBe(
      "abc123def4",
    );
  });

  it("rejects unknown hosts, plain http, and provider mismatches", () => {
    expect(resolveLessonVideo("https://example.com/video.mp4")).toBeNull();
    expect(resolveLessonVideo("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(resolveLessonVideo("https://youtu.be/dQw4w9WgXcQ", "vimeo")).toBeNull();
    expect(resolveLessonVideo("https://acme.wistia.com/medias/abc123def4", "loom")).toBeNull();
  });
});

describe("labels", () => {
  it("formats progress", () => {
    expect(progressLabel(0)).toBe("Not started");
    expect(progressLabel(41.6)).toBe("42% complete");
    expect(progressLabel(140)).toBe("Completed");
  });

  it("formats lesson counts and file sizes", () => {
    expect(lessonCountLabel(1)).toBe("1 lesson");
    expect(lessonCountLabel(1240, "en-US")).toBe("1,240 lessons");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536, "en-US")).toBe("1.5 KB");
    expect(formatFileSize(25 * 1024 * 1024, "en-US")).toBe("25 MB");
  });
});
