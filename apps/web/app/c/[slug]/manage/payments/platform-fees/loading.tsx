import { Skeleton } from "../../../../../../components/skeleton";

export default function PlatformFeesLoading() {
  return (
    <div role="status" aria-label="Loading platform fees" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
