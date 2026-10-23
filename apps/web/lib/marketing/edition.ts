import type { Edition } from "@cohory/config/edition";

export const marketingPaths = ["/pricing", "/open-source"] as const;

export function hasMarketingPages(edition: Edition): boolean {
  return edition === "cloud";
}
