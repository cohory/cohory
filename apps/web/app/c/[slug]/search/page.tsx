import type { Metadata } from "next";

import { SearchForm } from "../../../../components/search/search-form";
import { SearchResultsView } from "../../../../components/search/search-results";
import { requireFullCommunityPage } from "../../../../lib/communities/load";
import { readQuery, runSearch } from "../../../../lib/search/load";

export const metadata: Metadata = { title: "Search" };

export default async function CommunitySearchPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/search">) {
  const page = await requireFullCommunityPage((await params).slug);
  const query = readQuery((await searchParams).q);
  const outcome = await runSearch(page, query);
  const slug = page.community.slug;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h2 className="text-2xl font-semibold text-text">Search</h2>
      <SearchForm slug={slug} query={query} autoFocus={outcome.kind === "empty"} />
      {outcome.kind === "empty" ? (
        <p className="text-sm text-text-muted">Search posts, comments, members, and lessons.</p>
      ) : null}
      {outcome.kind === "invalid" ? (
        <p role="alert" className="text-sm text-danger">
          Type at least two letters or numbers to search.
        </p>
      ) : null}
      {outcome.kind === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {outcome.message}
        </p>
      ) : null}
      {outcome.kind === "results" ? (
        <SearchResultsView slug={slug} results={outcome.results} />
      ) : null}
    </div>
  );
}
