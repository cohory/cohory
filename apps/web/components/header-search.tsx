"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@cohory/ui";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

function SearchFields({ slug, id, autoFocus }: { slug: string; id: string; autoFocus?: boolean }) {
  const searchParams = useSearchParams();
  return (
    <form role="search" action={`/c/${slug}/search`} method="get" className="flex w-full gap-2">
      <label htmlFor={id} className="sr-only">
        Search this community
      </label>
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          strokeWidth={1.5}
        />
        <Input
          id={id}
          type="search"
          name="q"
          placeholder="Search"
          maxLength={100}
          autoFocus={autoFocus}
          defaultValue={searchParams.get("q") ?? ""}
          className="min-h-11 pl-9"
        />
      </div>
      {autoFocus ? (
        <Button type="submit" className="min-h-11">
          Search
        </Button>
      ) : null}
    </form>
  );
}

export function HeaderSearchPlaceholder() {
  return (
    <>
      <div aria-hidden="true" className="hidden h-11 w-48 md:block lg:w-64" />
      <div aria-hidden="true" className="size-11 md:hidden" />
    </>
  );
}

export function HeaderSearch({ slug, name }: { slug: string; name: string }) {
  return (
    <>
      <div className="hidden w-48 md:block lg:w-64">
        <SearchFields slug={slug} id="header-search" />
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className="size-11 px-0 md:hidden"
            aria-label="Search this community"
          >
            <Search aria-hidden="true" className="size-5" strokeWidth={1.5} />
          </Button>
        </DialogTrigger>
        <DialogContent className="top-4 translate-y-0 sm:top-1/2 sm:-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Posts, comments, members, and lessons in {name}.</DialogDescription>
          </DialogHeader>
          <SearchFields slug={slug} id="header-search-dialog" autoFocus />
        </DialogContent>
      </Dialog>
    </>
  );
}
