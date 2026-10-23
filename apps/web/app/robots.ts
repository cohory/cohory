import { getPlatformConfig } from "@cohory/config/platform";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { robotsFor, sitemapEnabled } from "../lib/seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return robotsFor({ appUrl: getPlatformConfig().appUrl, sitemap: sitemapEnabled() });
}
