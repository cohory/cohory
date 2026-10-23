import { getSearchService } from "@cohory/api/services";
import { ForbiddenError } from "@cohory/authz";
import { rateLimitKey, RateLimitedError } from "@cohory/rate-limit";
import { SearchValidationError, type SearchResults } from "@cohory/search";
import { headers } from "next/headers";

import type { FullCommunityPage } from "../communities/load";
import { rateLimitMessage } from "../posts/errors";

export type SearchOutcome =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly query: string }
  | { readonly kind: "error"; readonly query: string; readonly message: string }
  | { readonly kind: "results"; readonly results: SearchResults };

export function readQuery(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").slice(0, 200);
}

export async function runSearch(page: FullCommunityPage, query: string): Promise<SearchOutcome> {
  if (query.trim() === "") {
    return { kind: "empty" };
  }
  const rateKey = rateLimitKey(page.actor, await headers());
  try {
    const results = await getSearchService().search(
      page.actor,
      page.community.id,
      { query },
      rateKey,
    );
    return { kind: "results", results };
  } catch (error) {
    if (error instanceof SearchValidationError) {
      return { kind: "invalid", query };
    }
    if (error instanceof RateLimitedError) {
      return { kind: "error", query, message: rateLimitMessage(error) };
    }
    if (error instanceof ForbiddenError) {
      return { kind: "error", query, message: "Join this community to search it." };
    }
    throw error;
  }
}
