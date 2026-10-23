import { Skeleton } from "../../../../components/skeleton";

export default function MembershipLoading() {
  return (
    <div role="status" aria-label="Loading membership" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-80 w-full max-w-md" />
    </div>
  );
}
