import { Skeleton } from "../../../../../components/skeleton";

export default function ManagePaymentsLoading() {
  return (
    <div role="status" aria-label="Loading payments" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
