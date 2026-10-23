"use client";

import {
  EmptyState,
  LevelFilter,
  MemberList,
  MemberSearch,
  toast,
  type LevelOption,
  type MemberListItem,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadMoreMembersAction } from "../../lib/members/actions";
import { directoryHref, type DirectoryParams } from "../../lib/members/params";
import { useDesktop } from "./use-desktop";

export interface MemberDirectoryProps {
  slug: string;
  params: DirectoryParams;
  initialMembers: MemberListItem[];
  initialCursor: string | null;
  gamificationEnabled: boolean;
  levels: LevelOption[];
}

export function MemberDirectory({
  slug,
  params,
  initialMembers,
  initialCursor,
  gamificationEnabled,
  levels,
}: MemberDirectoryProps) {
  const router = useRouter();
  const desktop = useDesktop();
  const [searching, startSearch] = useTransition();
  const [loadingMore, startLoadMore] = useTransition();
  const [extra, setExtra] = useState<{
    key: string;
    members: MemberListItem[];
    cursor: string | null;
  }>();
  const key = `${params.q}|${params.level ?? ""}|${initialCursor ?? ""}`;
  const current = extra?.key === key ? extra : { key, members: [], cursor: initialCursor };
  const members = [...initialMembers, ...current.members];

  function navigate(next: DirectoryParams) {
    startSearch(() => {
      router.replace(directoryHref(slug, next), { scroll: false });
    });
  }

  function loadMore() {
    const cursor = current.cursor;
    if (!cursor) return;
    startLoadMore(async () => {
      const result = await loadMoreMembersAction({
        slug,
        query: params.q,
        level: params.level,
        cursor,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setExtra({
        key,
        members: [...current.members, ...result.data.members],
        cursor: result.data.nextCursor,
      });
    });
  }

  const filtered = params.q.trim() !== "" || params.level !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <MemberSearch
          value={params.q}
          onChange={(q) => navigate({ ...params, q })}
          className="sm:flex-1"
        />
        {gamificationEnabled ? (
          <LevelFilter
            value={params.level}
            onChange={(level) => navigate({ ...params, level })}
            levels={levels}
            className="sm:w-56"
          />
        ) : null}
      </div>
      <div aria-busy={searching} className={searching ? "opacity-60" : undefined}>
        <MemberList
          members={members}
          variant={desktop ? "grid" : "list"}
          gamificationEnabled={gamificationEnabled}
          hasMore={current.cursor !== null}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          emptyState={
            <EmptyState title={filtered ? "No members match your search." : "No members yet."} />
          }
        />
      </div>
    </div>
  );
}
