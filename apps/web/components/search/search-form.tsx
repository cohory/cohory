"use client";

import { Button, Input } from "@cohory/ui";
import { Search } from "lucide-react";

import { useWideScreenFocus } from "../use-wide-screen-focus";

export function SearchForm({
  slug,
  query,
  autoFocus = false,
}: {
  slug: string;
  query: string;
  autoFocus?: boolean;
}) {
  const focusOnWideScreen = useWideScreenFocus<HTMLInputElement>();
  return (
    <form role="search" action={`/c/${slug}/search`} method="get" className="flex gap-2">
      <label htmlFor="community-search" className="sr-only">
        Search posts, members, and lessons
      </label>
      <Input
        id="community-search"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search posts, members, and lessons"
        maxLength={100}
        ref={autoFocus ? focusOnWideScreen : undefined}
        className="min-h-11"
      />
      <Button type="submit" className="min-h-11">
        <Search aria-hidden="true" className="size-4" strokeWidth={1.5} />
        Search
      </Button>
    </form>
  );
}
