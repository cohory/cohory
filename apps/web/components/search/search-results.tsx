import type { ExcerptSegment } from "@cohory/db";
import type { SearchResults } from "@cohory/search";
import Link from "next/link";
import type { ReactNode } from "react";

import { lessonHref } from "../../lib/courses/hrefs";

function Excerpt({ segments }: { segments: readonly ExcerptSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <p className="line-clamp-2 text-sm text-text-muted">
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-warning-muted px-0.5 text-text">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function Group({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-lg font-semibold text-text">
        {title} <span className="text-sm font-normal text-text-muted">({count})</span>
      </h3>
      {count === 0 ? <p className="text-sm text-text-muted">No matches.</p> : children}
    </section>
  );
}

const itemClass =
  "flex flex-col gap-1 rounded-md border border-border bg-surface p-3 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring";

export function SearchResultsView({ slug, results }: { slug: string; results: SearchResults }) {
  const total = results.posts.length + results.members.length + results.lessons.length;
  if (total === 0) {
    return (
      <p role="status" className="text-sm text-text-muted">
        No results for &lsquo;{results.query}&rsquo;. Try fewer words.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <p role="status" className="sr-only">
        {total === 1 ? "1 result" : `${total} results`} for {results.query}
      </p>
      <Group id="results-posts" title="Posts" count={results.posts.length}>
        <ul className="flex flex-col gap-2">
          {results.posts.map((hit) => (
            <li key={hit.postId}>
              <Link href={`/c/${slug}/posts/${hit.postId}`} className={itemClass}>
                <span className="font-medium text-text">{hit.title ?? "Untitled post"}</span>
                <span className="text-xs text-text-muted">
                  {hit.commentId ? `Comment by ${hit.authorName}` : `Post by ${hit.authorName}`}
                </span>
                <Excerpt segments={hit.excerpt} />
              </Link>
            </li>
          ))}
        </ul>
      </Group>
      <Group id="results-members" title="Members" count={results.members.length}>
        <ul className="flex flex-col gap-2">
          {results.members.map((hit) => (
            <li key={hit.userId}>
              <Link href={`/c/${slug}/members/${hit.userId}`} className={itemClass}>
                <span className="font-medium text-text">{hit.name}</span>
                {hit.username ? (
                  <span className="text-xs text-text-muted">@{hit.username}</span>
                ) : null}
                <Excerpt segments={hit.bioExcerpt} />
              </Link>
            </li>
          ))}
        </ul>
      </Group>
      <Group id="results-lessons" title="Classroom" count={results.lessons.length}>
        <ul className="flex flex-col gap-2">
          {results.lessons.map((hit) => (
            <li key={`${hit.courseSlug}/${hit.lessonSlug}`}>
              <Link href={lessonHref(slug, hit.courseSlug, hit.lessonSlug)} className={itemClass}>
                <span className="font-medium text-text">{hit.lessonTitle}</span>
                <span className="text-xs text-text-muted">{hit.courseTitle}</span>
                <Excerpt segments={hit.excerpt} />
              </Link>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
