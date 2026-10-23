"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { refreshCommunityAction } from "../../lib/migration/actions";
import { isActive, type MigrationJobJson } from "../../lib/migration/jobs";

export function useRefreshAfterSuccess(slug: string, jobs: readonly MigrationJobJson[]): void {
  const router = useRouter();
  const seenActive = useRef(new Set<string>());
  useEffect(() => {
    let finished = false;
    for (const job of jobs) {
      if (isActive(job)) {
        seenActive.current.add(job.id);
      } else if (job.status === "succeeded" && seenActive.current.delete(job.id)) {
        finished = true;
      }
    }
    if (!finished) return;
    void refreshCommunityAction(slug).then(() => router.refresh());
  }, [jobs, router, slug]);
}
