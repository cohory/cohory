"use client";

import type { ReactNode } from "react";

import { AuthorAvatar } from "../community/author-avatar";
import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { formatAbsoluteDate } from "../community/relative-time";
import { Badge } from "../primitives/badge";
import { Skeleton } from "../primitives/skeleton";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { LevelBadge } from "./level-badge";
import { firstLine, formatPoints, roleLabel, type MemberSummary } from "./types";

type MemberCardVariant = "list" | "grid";

interface MemberCardProps {
  member: MemberSummary;
  href: string;
  actions?: ItemAction[];
  details?: ReactNode;
  variant?: MemberCardVariant;
  gamificationEnabled?: boolean;
  locale?: string;
  className?: string;
}

function MemberCard({
  member,
  href,
  actions = [],
  details,
  variant = "list",
  gamificationEnabled = true,
  locale,
  className,
}: MemberCardProps) {
  const role = roleLabel(member.role);
  const grid = variant === "grid";
  const bio = firstLine(member.bio);

  return (
    <article
      data-slot="member-card"
      data-variant={variant}
      className={cn(
        "relative flex rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-bg hover:bg-surface-hover motion-reduce:transition-none",
        grid ? "flex-col items-center gap-3 p-6 text-center" : "items-center gap-3 p-4",
        className,
      )}
    >
      <AuthorAvatar
        name={member.name}
        avatarUrl={member.image}
        className={grid ? "size-16" : "size-10"}
      />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", grid && "items-center")}>
        <div className={cn("flex min-w-0 flex-wrap items-center gap-2", grid && "justify-center")}>
          <h3 className="min-w-0 truncate text-base font-medium text-text">
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
            >
              {member.name}
            </Link>
          </h3>
          <LevelBadge
            level={member.level}
            name={member.levelName}
            disabled={!gamificationEnabled}
            className="relative"
          />
          {role ? <Badge variant="neutral">{role}</Badge> : null}
          {member.isNew ? <Badge variant="accent">New</Badge> : null}
        </div>
        {member.username ? (
          <p className="truncate text-sm text-text-muted">@{member.username}</p>
        ) : null}
        {bio ? <p className="line-clamp-2 text-sm text-text">{bio}</p> : null}
        <p className="text-sm text-text-muted">
          {gamificationEnabled ? (
            <>
              <span className="tabular-nums">{formatPoints(member.points, locale)}</span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          <span
            suppressHydrationWarning
          >{`Joined ${formatAbsoluteDate(member.joinedAt, locale)}`}</span>
        </p>
        {details ? (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted",
              grid && "justify-center",
            )}
          >
            {details}
          </div>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className={cn("relative", grid && "absolute top-2 right-2")}>
          <ItemActionsMenu actions={actions} label={`Actions for ${member.name}`} />
        </div>
      ) : null}
    </article>
  );
}

interface MemberCardSkeletonProps {
  variant?: MemberCardVariant;
  className?: string;
}

function MemberCardSkeleton({ variant = "list", className }: MemberCardSkeletonProps) {
  const grid = variant === "grid";
  return (
    <div
      data-slot="member-card-skeleton"
      aria-hidden="true"
      className={cn(
        "flex rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow)",
        grid ? "flex-col items-center gap-3 p-6" : "items-center gap-3 p-4",
        className,
      )}
    >
      <Skeleton className={cn("rounded-full", grid ? "size-16" : "size-10")} />
      <div className={cn("flex flex-1 flex-col gap-2", grid && "w-full items-center")}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  );
}

export {
  MemberCard,
  MemberCardSkeleton,
  type MemberCardProps,
  type MemberCardSkeletonProps,
  type MemberCardVariant,
};
