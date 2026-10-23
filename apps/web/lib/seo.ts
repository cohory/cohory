import type { PublicCommunityEntry } from "@cohory/communities/public-listing";
import type { Edition } from "@cohory/config/edition";
import type { MetadataRoute } from "next";
import { z } from "zod";

import { aboutHref } from "./communities/join-state";
import { hasMarketingPages, marketingPaths } from "./marketing/edition";

type Env = Readonly<Record<string, string | undefined>>;

const sitemapEnvSchema = z.object({
  SITEMAP_ENABLED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["true", "false"]).default("true"),
  ),
});

export function sitemapEnabled(env: Env = process.env): boolean {
  const parsed = sitemapEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Invalid configuration: SITEMAP_ENABLED must be true or false");
  }
  return parsed.data.SITEMAP_ENABLED === "true";
}

const disallowed = [
  "/account",
  "/api/",
  "/join/",
  "/oauth/",
  "/mcp",
  "/communities/new",
  "/c/*/manage",
  "/c/*/membership",
];

export function robotsFor({
  appUrl,
  sitemap,
}: {
  appUrl: string;
  sitemap: boolean;
}): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: disallowed },
    ...(sitemap ? { sitemap: `${appUrl}/sitemap.xml` } : {}),
  };
}

export function sitemapFor({
  appUrl,
  communities,
  importers,
  edition,
}: {
  appUrl: string;
  communities: readonly PublicCommunityEntry[];
  importers: readonly string[];
  edition: Edition;
}): MetadataRoute.Sitemap {
  return [
    { url: `${appUrl}/` },
    ...(hasMarketingPages(edition)
      ? marketingPaths.map((path) => ({ url: `${appUrl}${path}` }))
      : []),
    ...importers.map((source) => ({ url: `${appUrl}/importers/${encodeURIComponent(source)}` })),
    ...communities.map((community) => ({
      url: `${appUrl}${aboutHref(community.slug)}`,
      lastModified: community.updatedAt,
    })),
  ];
}
