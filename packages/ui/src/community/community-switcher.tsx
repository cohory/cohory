"use client";

import { CheckIcon, HouseIcon, PlusIcon } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../primitives/dropdown-menu";
import { cn } from "../lib/utils";

interface SwitcherCommunity {
  slug: string;
  name: string;
  logoUrl?: string | null;
  unread?: number;
}

interface CommunitySwitcherItemsProps {
  communities: readonly SwitcherCommunity[];
  currentSlug?: string | null;
  homeHref?: string;
  createHref?: string | null;
}

interface CommunityMarkProps {
  name: string;
  logoUrl?: string | null;
  className?: string;
}

function CommunityMark({ name, logoUrl, className }: CommunityMarkProps) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        data-slot="community-mark"
        className={cn("size-6 shrink-0 rounded-sm border border-border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-slot="community-mark"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-sm bg-accent-muted text-xs font-semibold text-text",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function CommunitySwitcherItems({
  communities,
  currentSlug = null,
  homeHref = "/",
  createHref = "/communities/new",
}: CommunitySwitcherItemsProps) {
  return (
    <DropdownMenuGroup aria-label="Your communities">
      <DropdownMenuLabel className="text-xs text-text-muted">Your communities</DropdownMenuLabel>
      <DropdownMenuItem asChild className="min-h-11">
        <a href={homeHref}>
          <HouseIcon aria-hidden="true" />
          Home
        </a>
      </DropdownMenuItem>
      {communities.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-text-muted">You haven&apos;t joined one yet.</p>
      ) : (
        communities.map((community) => {
          const active = community.slug === currentSlug;
          return (
            <DropdownMenuItem key={community.slug} asChild className="min-h-11">
              <a href={`/c/${community.slug}`} aria-current={active ? "page" : undefined}>
                <CommunityMark name={community.name} logoUrl={community.logoUrl} />
                <span className="min-w-0 flex-1 truncate">{community.name}</span>
                {community.unread ? (
                  <span className="rounded-full bg-accent-muted px-1.5 text-xs text-text">
                    {community.unread > 99 ? "99+" : community.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
                {active ? <CheckIcon aria-hidden="true" className="size-4" /> : null}
              </a>
            </DropdownMenuItem>
          );
        })
      )}
      {createHref ? (
        <DropdownMenuItem asChild className="min-h-11">
          <a href={createHref}>
            <PlusIcon aria-hidden="true" />
            Create a community
          </a>
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuGroup>
  );
}

export {
  CommunityMark,
  CommunitySwitcherItems,
  type CommunityMarkProps,
  type CommunitySwitcherItemsProps,
  type SwitcherCommunity,
};
