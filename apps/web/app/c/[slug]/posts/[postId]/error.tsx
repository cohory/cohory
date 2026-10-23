"use client";

import { Button } from "@cohory/ui";
import { CircleAlert } from "lucide-react";

import { EmptyState } from "../../../../../components/empty-state";

export default function PostError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="We couldn't load this post"
      action={<Button onClick={retry}>Try again</Button>}
    >
      Check your connection and try again.
    </EmptyState>
  );
}
