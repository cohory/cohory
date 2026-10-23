"use client";

import { MedalIcon } from "lucide-react";

import { AuthorAvatar } from "../community/author-avatar";
import { EmptyState } from "../community/empty-state";
import { Badge } from "../primitives/badge";
import { Skeleton } from "../primitives/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/tabs";
import { cn } from "../lib/utils";
import { LevelBadge } from "./level-badge";
import { formatPoints } from "./types";

type LeaderboardWindow = "7d" | "all";

interface LeaderboardMember {
  userId: string;
  name: string;
  image?: string | null;
  level: number;
  levelName?: string | null;
}

interface LeaderboardEntry {
  rank: number;
  member: LeaderboardMember;
  points: number;
  href?: string;
}

interface LeaderboardViewer {
  rank: number;
  points: number;
}

interface LeaderboardProps {
  window: LeaderboardWindow;
  onWindowChange(window: LeaderboardWindow): void;
  entries: LeaderboardEntry[];
  viewer?: LeaderboardViewer | null;
  disabled?: boolean;
  limit?: number;
  emptyMessage?: string;
  locale?: string;
  className?: string;
}

const WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  "7d": "7 days",
  all: "All time",
};

const DEFAULT_LIMIT = 10;

function isLeaderboardWindow(value: string): value is LeaderboardWindow {
  return value === "7d" || value === "all";
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span className="flex w-10 shrink-0 items-center gap-1 text-sm font-medium text-text tabular-nums">
      {rank <= 3 ? <MedalIcon aria-hidden="true" className="size-4 text-accent" /> : null}
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

function PointsCell({ points, locale }: { points: number; locale?: string }) {
  return (
    <span className="shrink-0 text-sm text-text-muted tabular-nums">
      {formatPoints(points, locale)}
    </span>
  );
}

function Leaderboard({
  window,
  onWindowChange,
  entries,
  viewer,
  disabled = false,
  limit = DEFAULT_LIMIT,
  emptyMessage = "No points yet.",
  locale,
  className,
}: LeaderboardProps) {
  if (disabled) {
    return (
      <section data-slot="leaderboard" className={className}>
        <EmptyState title="Leaderboard is turned off for this community" />
      </section>
    );
  }

  const shown = entries.slice(0, limit);
  const lastShownRank = shown.at(-1)?.rank ?? 0;
  const pinViewer = viewer !== null && viewer !== undefined && viewer.rank > lastShownRank;

  return (
    <section data-slot="leaderboard" aria-label="Leaderboard" className={className}>
      <Tabs
        value={window}
        onValueChange={(value) => {
          if (isLeaderboardWindow(value)) onWindowChange(value);
        }}
      >
        <TabsList aria-label="Leaderboard period">
          {(Object.keys(WINDOW_LABELS) as LeaderboardWindow[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {WINDOW_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={window} className="flex flex-col gap-2">
          {shown.length === 0 ? (
            <EmptyState title={emptyMessage} />
          ) : (
            <ol aria-label={`Top members, ${WINDOW_LABELS[window]}`} className="flex flex-col">
              {shown.map((entry) => (
                <li
                  key={entry.member.userId}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2"
                >
                  <RankCell rank={entry.rank} />
                  <AuthorAvatar
                    name={entry.member.name}
                    avatarUrl={entry.member.image}
                    className="size-8"
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {entry.href ? (
                      <a
                        href={entry.href}
                        className="truncate text-sm font-medium text-text outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {entry.member.name}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-medium text-text">
                        {entry.member.name}
                      </span>
                    )}
                    <LevelBadge level={entry.member.level} name={entry.member.levelName} />
                  </span>
                  <PointsCell points={entry.points} locale={locale} />
                </li>
              ))}
            </ol>
          )}
          {pinViewer ? (
            <div
              data-slot="leaderboard-viewer"
              className="flex min-h-11 items-center gap-3 rounded-md border-t border-border bg-accent-muted px-2 py-2"
            >
              <RankCell rank={viewer.rank} />
              <span className="flex-1 text-sm font-medium text-text">You</span>
              <span className="shrink-0 text-sm text-text tabular-nums">
                {formatPoints(viewer.points, locale)}
              </span>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}

interface LevelLadderStep {
  level: number;
  name?: string | null;
  minPoints: number;
  share: number;
}

interface LevelLadderProps {
  steps: LevelLadderStep[];
  currentLevel?: number | null;
  locale?: string;
  className?: string;
}

function LevelLadder({ steps, currentLevel, locale, className }: LevelLadderProps) {
  return (
    <ol data-slot="level-ladder" aria-label="Levels" className={cn("flex flex-col", className)}>
      {steps.map((step) => {
        const current = step.level === currentLevel;
        return (
          <li
            key={step.level}
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-md px-2 py-2",
              current && "border border-border-strong",
            )}
          >
            <span aria-hidden="true" className="flex">
              <LevelBadge level={step.level} name={step.name} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text">
                <span className="truncate">
                  Level {step.level}
                  {step.name ? <span className="text-text-muted"> · {step.name}</span> : null}
                </span>
                {current ? <Badge variant="neutral">You</Badge> : null}
              </span>
              <span className="text-sm text-text-muted tabular-nums">
                {formatPoints(step.minPoints, locale)}
              </span>
            </span>
            <span className="shrink-0 text-sm text-text-muted tabular-nums">
              {`${new Intl.NumberFormat(locale).format(step.share)}% of members`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LeaderboardSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div
      data-slot="leaderboard-skeleton"
      role="status"
      aria-label="Loading leaderboard"
      className={cn("flex flex-col gap-3", className)}
    >
      <Skeleton className="h-10 w-48" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export {
  Leaderboard,
  LeaderboardSkeleton,
  LevelLadder,
  type LevelLadderProps,
  type LevelLadderStep,
  type LeaderboardEntry,
  type LeaderboardMember,
  type LeaderboardProps,
  type LeaderboardViewer,
  type LeaderboardWindow,
};
