import { listPublicCommunities } from "@cohory/communities/public-listing";
import { getPlatformConfig } from "@cohory/config/platform";
import { importerIds } from "@cohory/migration/importers";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { sitemapEnabled, sitemapFor } from "../lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  if (!sitemapEnabled()) {
    return [];
  }
  const { appUrl, edition } = getPlatformConfig();
  return [
    ...sitemapFor({
      appUrl,
      communities: await listPublicCommunities(),
      importers: importerIds,
      edition,
    }),
    { url: `${appUrl}/importers` },
  ];
}
