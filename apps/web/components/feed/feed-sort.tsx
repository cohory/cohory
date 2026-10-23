import { cn } from "@cohory/ui";
import Link from "next/link";

import {
  feedHref,
  feedSortOptions,
  type FeedAudience,
  type FeedUrlState,
} from "../../lib/posts/feed-url";

export function FeedSortControl({
  slug,
  state,
  audience = "member",
}: {
  slug: string;
  state: FeedUrlState;
  audience?: FeedAudience;
}) {
  return (
    <nav aria-label="Sort posts" className="px-4 md:px-0">
      <ul className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-hover p-1">
        {feedSortOptions.map((option) => {
          const active = state.sort === option.value;
          return (
            <li key={option.value}>
              <Link
                href={feedHref(slug, { ...state, sort: option.value }, audience)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
                )}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
