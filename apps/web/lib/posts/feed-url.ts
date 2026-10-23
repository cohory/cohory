import { feedCategorySchema } from "./schemas";

export const feedSortOptions = [
  { value: "active", label: "Active" },
  { value: "new", label: "Newest" },
  { value: "top", label: "Top" },
] as const;

export type FeedSort = (typeof feedSortOptions)[number]["value"];

export const defaultFeedSort: FeedSort = "active";

export interface FeedUrlState {
  readonly category: string | null;
  readonly sort: FeedSort;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSort(value: string | undefined): FeedSort {
  return feedSortOptions.find((option) => option.value === value)?.value ?? defaultFeedSort;
}

export function parseFeedSearchParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): FeedUrlState {
  const category = feedCategorySchema.safeParse(first(params.category));
  return {
    category: category.success ? category.data : null,
    sort: parseSort(first(params.sort)),
  };
}

export type FeedAudience = "member" | "visitor";

export function feedQuery(state: FeedUrlState): string {
  const query = new URLSearchParams();
  if (state.category) query.set("category", state.category);
  if (state.sort !== defaultFeedSort) query.set("sort", state.sort);
  return query.toString();
}

export function feedPath(slug: string, audience: FeedAudience = "member"): string {
  return audience === "visitor" ? `/c/${slug}/feed` : `/c/${slug}`;
}

export function feedHref(
  slug: string,
  state: FeedUrlState,
  audience: FeedAudience = "member",
): string {
  const search = feedQuery(state);
  const path = feedPath(slug, audience);
  return search ? `${path}?${search}` : path;
}
