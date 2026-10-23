import { MemberCardSkeleton } from "@cohory/ui";

import { Skeleton } from "../skeleton";

export function DirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading members" className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full" />
      <div className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <MemberCardSkeleton key={row} />
        ))}
      </div>
    </div>
  );
}
