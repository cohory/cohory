"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { ItemAction } from "../community/item-actions";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { cn } from "../lib/utils";
import { MemberCard, MemberCardSkeleton, type MemberCardVariant } from "./member-card";
import type { MemberSummary } from "./types";

interface MemberSearchProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  label?: string;
  debounceMs?: number;
  className?: string;
}

function MemberSearch({
  value,
  onChange,
  placeholder = "Search members",
  label = "Search members",
  debounceMs = 300,
  className,
}: MemberSearchProps) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);

  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChangeRef.current(draft), debounceMs);
    return () => clearTimeout(timer);
  }, [draft, value, debounceMs]);

  function clear() {
    setDraft("");
    onChangeRef.current("");
    inputRef.current?.focus();
  }

  return (
    <div data-slot="member-search" role="search" className={cn("relative w-full", className)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
      />
      <Input
        ref={inputRef}
        type="search"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            clear();
          }
        }}
        className="pr-11 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-0 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

interface LevelOption {
  level: number;
  name?: string | null;
}

interface LevelFilterProps {
  value: number | null;
  onChange(value: number | null): void;
  levels: LevelOption[];
  label?: string;
  className?: string;
}

function LevelFilter({
  value,
  onChange,
  levels,
  label = "Filter by level",
  className,
}: LevelFilterProps) {
  const id = useId();
  return (
    <div data-slot="level-filter" className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
        className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-sm"
      >
        <option value="">All levels</option>
        {levels.map((option) => (
          <option key={option.level} value={String(option.level)}>
            {option.name ? `Level ${option.level}, ${option.name}` : `Level ${option.level}`}
          </option>
        ))}
      </select>
    </div>
  );
}

interface MemberListItem {
  member: MemberSummary;
  href: string;
  actions?: ItemAction[];
}

interface MemberListProps {
  members: MemberListItem[];
  variant?: MemberCardVariant;
  hasMore?: boolean;
  onLoadMore?(): void;
  loading?: boolean;
  loadingMore?: boolean;
  emptyState?: ReactNode;
  gamificationEnabled?: boolean;
  locale?: string;
  label?: string;
  className?: string;
}

const SKELETON_COUNT = 6;

function MemberList({
  members,
  variant = "list",
  hasMore = false,
  onLoadMore,
  loading = false,
  loadingMore = false,
  emptyState,
  gamificationEnabled = true,
  locale,
  label = "Members",
  className,
}: MemberListProps) {
  const layout =
    variant === "grid"
      ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      : "flex flex-col gap-2";

  if (loading) {
    return (
      <div
        data-slot="member-list"
        role="status"
        aria-label="Loading members"
        className={cn(layout, className)}
      >
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <MemberCardSkeleton key={index} variant={variant} />
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return <div data-slot="member-list">{emptyState ?? null}</div>;
  }

  return (
    <div data-slot="member-list" className={cn("flex flex-col gap-4", className)}>
      <ul aria-label={label} className={layout}>
        {members.map((item) => (
          <li key={item.member.userId}>
            <MemberCard
              member={item.member}
              href={item.href}
              actions={item.actions}
              variant={variant}
              gamificationEnabled={gamificationEnabled}
              locale={locale}
              className="h-full"
            />
          </li>
        ))}
      </ul>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            onClick={onLoadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading members…" : "Show more members"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export {
  LevelFilter,
  MemberList,
  MemberSearch,
  type LevelFilterProps,
  type LevelOption,
  type MemberListItem,
  type MemberListProps,
  type MemberSearchProps,
};
