import { CourseCardSkeleton } from "@cohory/ui";

import { Skeleton } from "../skeleton";

export function ClassroomSkeleton() {
  return (
    <div role="status" aria-label="Loading courses" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CourseCardSkeleton />
        <CourseCardSkeleton />
        <CourseCardSkeleton />
      </div>
    </div>
  );
}
