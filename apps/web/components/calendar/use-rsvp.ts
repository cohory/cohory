"use client";

import { toast, type EventOccurrence, type RsvpStatus } from "@cohory/ui";
import { useCallback, useState, useTransition } from "react";

import { rsvpAction } from "../../lib/calendar/actions";

interface RsvpOverride {
  readonly viewerStatus: RsvpStatus;
  readonly goingCount: number;
}

function optimisticCount(occurrence: EventOccurrence, status: RsvpStatus): number {
  const wasGoing = occurrence.viewerStatus === "going";
  const isGoing = status === "going";
  if (wasGoing === isGoing) return occurrence.goingCount;
  return Math.max(0, occurrence.goingCount + (isGoing ? 1 : -1));
}

export function useRsvp(slug: string) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, RsvpOverride>>(new Map());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const apply = useCallback(
    (occurrence: EventOccurrence): EventOccurrence => {
      const override = overrides.get(occurrence.id);
      return override ? { ...occurrence, ...override } : occurrence;
    },
    [overrides],
  );

  const setOverride = useCallback((id: string, override: RsvpOverride | null) => {
    setOverrides((current) => {
      const next = new Map(current);
      if (override) next.set(id, override);
      else next.delete(id);
      return next;
    });
  }, []);

  const rsvp = useCallback(
    (raw: EventOccurrence, status: RsvpStatus) => {
      const occurrence = apply(raw);
      const previous = overrides.get(raw.id) ?? null;
      setOverride(raw.id, {
        viewerStatus: status,
        goingCount: optimisticCount(occurrence, status),
      });
      setPendingId(raw.id);
      startTransition(async () => {
        const result = await rsvpAction({ slug, occurrenceId: raw.id, status });
        setPendingId(null);
        if (!result.ok) {
          setOverride(raw.id, previous);
          toast.error(result.message);
          return;
        }
        setOverride(raw.id, {
          viewerStatus: result.data.status,
          goingCount: result.data.goingCount,
        });
      });
    },
    [apply, overrides, setOverride, slug],
  );

  return { apply, rsvp, pendingId };
}
