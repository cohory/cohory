import { describe, expect, it } from "vitest";

import { robotsFor, sitemapEnabled, sitemapFor } from "./seo";

const appUrl = "https://acme.example.com";

describe("sitemapEnabled", () => {
  it("is on unless the operator turns it off", () => {
    expect(sitemapEnabled({})).toBe(true);
    expect(sitemapEnabled({ SITEMAP_ENABLED: "" })).toBe(true);
    expect(sitemapEnabled({ SITEMAP_ENABLED: "true" })).toBe(true);
    expect(sitemapEnabled({ SITEMAP_ENABLED: "false" })).toBe(false);
  });

  it("rejects a value that is not true or false", () => {
    expect(() => sitemapEnabled({ SITEMAP_ENABLED: "no" })).toThrow(/SITEMAP_ENABLED/);
  });
});

describe("robotsFor", () => {
  it("keeps crawlers out of private and personal areas", () => {
    const robots = robotsFor({ appUrl, sitemap: true });
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;

    expect(rules?.allow).toBe("/");
    expect(rules?.disallow).toEqual(
      expect.arrayContaining([
        "/account",
        "/api/",
        "/join/",
        "/oauth/",
        "/mcp",
        "/c/*/manage",
        "/c/*/membership",
      ]),
    );
  });

  it("points to the sitemap only when it is on", () => {
    expect(robotsFor({ appUrl, sitemap: true }).sitemap).toBe(`${appUrl}/sitemap.xml`);
    expect(robotsFor({ appUrl, sitemap: false }).sitemap).toBeUndefined();
  });
});

describe("sitemapFor", () => {
  const updatedAt = new Date("2026-10-01T00:00:00Z");

  it("lists home, importer guides, and the About page of each public community", () => {
    const urls = sitemapFor({
      appUrl,
      communities: [{ slug: "makers-guild", updatedAt }],
      importers: ["skool"],
      edition: "community",
    }).map((entry) => entry.url);

    expect(urls).toEqual([
      `${appUrl}/`,
      `${appUrl}/importers/skool`,
      `${appUrl}/c/makers-guild/about`,
    ]);
  });

  it("adds the pricing and open source pages on the Cloud Edition", () => {
    const urls = sitemapFor({ appUrl, communities: [], importers: [], edition: "cloud" }).map(
      (entry) => entry.url,
    );

    expect(urls).toEqual([`${appUrl}/`, `${appUrl}/pricing`, `${appUrl}/open-source`]);
  });

  it("dates each About page by when the community last changed", () => {
    const entry = sitemapFor({
      appUrl,
      communities: [{ slug: "makers-guild", updatedAt }],
      importers: [],
      edition: "community",
    }).at(-1);

    expect(entry?.lastModified).toEqual(updatedAt);
  });
});
