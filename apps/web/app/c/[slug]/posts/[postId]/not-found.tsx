import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "../../../../../components/empty-state";

export default function PostNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="This post isn't available"
      action={
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to My communities
        </Link>
      }
    >
      It may have been deleted, or you may not have access to it.
    </EmptyState>
  );
}
