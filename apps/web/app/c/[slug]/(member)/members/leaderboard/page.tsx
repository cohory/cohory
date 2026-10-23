import { LevelLadder, LevelProgress } from "@cohory/ui";
import { ArrowLeft, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "../../../../../../components/empty-state";
import { LeaderboardView } from "../../../../../../components/members/leaderboard-view";
import { loadLeaderboard } from "../../../../../../lib/members/load";
import { parseLeaderboardWindow } from "../../../../../../lib/members/params";

export const metadata: Metadata = { title: "Leaderboard" };

const card = "rounded-(--card-radius) border border-border bg-surface p-4 shadow-(--card-shadow)";

export default async function LeaderboardPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/members/leaderboard">) {
  const window = parseLeaderboardWindow(await searchParams);
  const data = await loadLeaderboard((await params).slug, window);
  const { community } = data.page;
  const board = data.status === "ok" && data.board.status === "enabled" ? data.board : null;

  return (
    <section aria-labelledby="leaderboard-heading" className="flex flex-col gap-4">
      <Link
        href={`/c/${community.slug}/members`}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-text-muted outline-none hover:text-text focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Members
      </Link>
      <h2 id="leaderboard-heading" className="text-xl text-text">
        Leaderboard
      </h2>
      {data.status === "forbidden" ? (
        <EmptyState icon={Users} title="The leaderboard is visible to members">
          Join this community to see who is contributing.
        </EmptyState>
      ) : (
        <>
          {board ? (
            <div className={`${card} flex flex-col gap-3`}>
              {board.progress ? (
                <LevelProgress
                  level={board.progress.level}
                  name={board.progress.name}
                  points={board.progress.points}
                  nextLevelAt={board.progress.nextLevelAt}
                />
              ) : null}
              <p className="text-sm text-text-muted">{board.earningLine}</p>
            </div>
          ) : null}
          <div className={card}>
            <LeaderboardView
              slug={community.slug}
              window={window}
              entries={board?.entries ?? []}
              viewer={board?.viewer ?? null}
              disabled={board === null}
            />
          </div>
          {board ? (
            <section aria-labelledby="levels-heading" className={`${card} flex flex-col gap-3`}>
              <h3 id="levels-heading" className="text-base font-medium text-text">
                Levels
              </h3>
              <LevelLadder steps={board.ladder} currentLevel={board.progress?.level ?? null} />
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
