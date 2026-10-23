"use client";

import { Leaderboard, type LeaderboardEntry, type LeaderboardViewer } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type LeaderboardWindow = "7d" | "all";

export interface LeaderboardViewProps {
  slug: string;
  window: LeaderboardWindow;
  entries: LeaderboardEntry[];
  viewer: LeaderboardViewer | null;
  disabled: boolean;
}

export function LeaderboardView({ slug, window, entries, viewer, disabled }: LeaderboardViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div aria-busy={pending} className={pending ? "opacity-60" : undefined}>
      <Leaderboard
        window={window}
        onWindowChange={(next) => {
          startTransition(() => {
            router.replace(`/c/${slug}/members/leaderboard?window=${next}`, { scroll: false });
          });
        }}
        entries={entries}
        viewer={viewer}
        disabled={disabled}
        emptyMessage="No points yet."
      />
    </div>
  );
}
