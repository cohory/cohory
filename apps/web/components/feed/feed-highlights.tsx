"use client";

import { Button, type EventOccurrence } from "@cohory/ui";
import { BookOpen, CalendarDays } from "lucide-react";
import { cn } from "@cohory/ui/lib/utils";
import Link from "next/link";

import { occurrenceHref } from "../../lib/calendar/hrefs";
import { useRsvp } from "../calendar/use-rsvp";

export interface LearningChip {
  readonly lessonTitle: string;
  readonly percent: number;
  readonly href: string;
}

export interface EventChip {
  readonly occurrence: EventOccurrence;
  readonly when: string;
}

const chipClass =
  "flex min-h-11 min-w-0 flex-1 basis-64 items-center gap-2 rounded-(--card-radius) border border-border bg-surface px-3 py-2 text-sm shadow-(--card-shadow)";

const linkClass =
  "min-w-0 flex-1 truncate rounded-sm font-medium text-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function FeedHighlights({
  slug,
  learning,
  events,
  canRsvp,
  className,
}: {
  slug: string;
  learning: LearningChip | null;
  events: readonly EventChip[];
  canRsvp: boolean;
  className?: string;
}) {
  const { apply, rsvp, pendingId } = useRsvp(slug);
  if (!learning && events.length === 0) return null;

  return (
    <section aria-label="Up next" className={cn("flex flex-wrap gap-2", className)}>
      {learning ? (
        <div data-slot="continue-learning-card" className={chipClass}>
          <BookOpen aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
          <Link href={learning.href} className={linkClass}>
            Continue {learning.lessonTitle}
          </Link>
          <span className="shrink-0 text-text-muted tabular-nums">{learning.percent}%</span>
        </div>
      ) : null}
      <div data-slot="upcoming-events-card" className="contents">
        {events.map(({ occurrence: raw, when }) => {
          const occurrence = apply(raw);
          const going = occurrence.viewerStatus === "going";
          return (
            <div key={occurrence.id} className={chipClass}>
              <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
              <Link
                href={occurrenceHref(slug, occurrence.eventSlug, occurrence.id)}
                className={linkClass}
              >
                {occurrence.title}
                <span className="font-normal text-text-muted"> · {when}</span>
              </Link>
              {going ? (
                <span className="shrink-0 text-text-muted">You&apos;re going</span>
              ) : canRsvp ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="min-h-11 shrink-0"
                  disabled={pendingId === occurrence.id}
                  aria-label={`Going to ${occurrence.title}`}
                  onClick={() => rsvp(raw, "going")}
                >
                  Going
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
