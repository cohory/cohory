import { describe, expect, it } from "vitest";

import { videoThumbnailHosts } from "@cohory/content";

import {
  contentSecurityPolicy,
  createNonce,
  embedFrameSources,
  videoThumbnailSources,
} from "./content-security-policy";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...values] = part.split(/\s+/);
        return [name, values] as const;
      }),
  );
}

describe("contentSecurityPolicy", () => {
  const policy = directives(contentSecurityPolicy({ nonce: "abc123", development: false }));

  it("allows scripts only with the request nonce and what those scripts load", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it("never allows inline or evaluated scripts in production", () => {
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows eval in development only, where React rebuilds server error stacks with it", () => {
    const dev = directives(contentSecurityPolicy({ nonce: "abc123", development: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
  });

  it("limits fetches and sockets from scripts to the same origin", () => {
    expect(policy.get("connect-src")).toEqual(["'self'"]);
  });

  it("allows only the video embed hosts in frames and forbids framing the app", () => {
    expect(policy.get("frame-src")).toEqual([...embedFrameSources]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("blocks plugins and base tag hijacking", () => {
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
  });

  it("loads embedded videos only from the privacy enhanced YouTube host, Vimeo, and Loom", () => {
    expect(policy.get("frame-src")).toEqual([
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
      "https://www.loom.com",
    ]);
    expect(policy.get("frame-src")).not.toContain("https://www.youtube.com");
  });

  it("allows video posters only from each provider's image host", () => {
    expect([...videoThumbnailSources]).toEqual(
      Object.values(videoThumbnailHosts).map((host) => `https://${host}`),
    );
  });

  it("keeps images on the same origin, data and blob URLs, and the video poster hosts", () => {
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:", ...videoThumbnailSources]);
    expect(policy.get("media-src")).toEqual(["'self'", "blob:"]);
  });
});

describe("createNonce", () => {
  it("returns a fresh base64 value of 128 bits each time", () => {
    const first = createNonce();
    const second = createNonce();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
