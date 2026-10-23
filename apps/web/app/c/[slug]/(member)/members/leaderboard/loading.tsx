import { LeaderboardSkeleton } from "@cohory/ui";

import { Skeleton } from "../../../../../../components/skeleton";

export default function LeaderboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-11 w-24" />
      <Skeleton className="h-7 w-36" />
      <div className="rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4">
        <LeaderboardSkeleton />
      </div>
    </div>
  );
}
