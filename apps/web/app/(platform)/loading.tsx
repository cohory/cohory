import { Skeleton } from "../../components/skeleton";

export default function PlatformLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
