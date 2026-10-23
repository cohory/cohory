"use client";

import { MapPinIcon, PlayCircleIcon, RepeatIcon, UsersIcon, VideoIcon } from "lucide-react";

import { safeLinkHref } from "../community/content";
import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Badge } from "../primitives/badge";
import { Skeleton } from "../primitives/skeleton";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { GoingFaces } from "./going-faces";
import { RsvpControls } from "./rsvp-controls";
import { dateBlockParts, formatDateLong, formatGoingCount, formatTimeRange } from "./time";
import type { EventOccurrence, RsvpStatus } from "./types";

type EventCardVariant = "list" | "compact";

interface EventCardProps {
  occurrence: EventOccurrence;
  timeZone: string;
  href: string;
  onRsvp?(status: RsvpStatus): void;
  rsvpPending?: boolean;
  actions?: ItemAction[];
  variant?: EventCardVariant;
  locale?: string;
  className?: string;
}

function EventDateBlock({
  startsAt,
  timeZone,
  locale,
  compact,
  muted,
}: {
  startsAt: string;
  timeZone: string;
  locale?: string;
  compact: boolean;
  muted: boolean;
}) {
  const parts = dateBlockParts(startsAt, timeZone, locale);
  return (
    <time
      dateTime={startsAt}
      data-slot="event-date-block"
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-md border border-border text-center leading-none",
        compact ? "w-12 gap-0.5 py-2" : "w-16 gap-1 py-2.5",
        muted ? "bg-surface-hover text-text-muted" : "bg-accent-muted text-text",
      )}
    >
      <span className="sr-only">{formatDateLong(startsAt, timeZone, locale)}</span>
      <span aria-hidden="true" className="text-xs font-medium uppercase">
        {parts.weekday}
      </span>
      <span
        aria-hidden="true"
        className={cn("font-semibold tabular-nums", compact ? "text-base" : "text-xl")}
      >
        {parts.day}
      </span>
      <span aria-hidden="true" className="text-xs uppercase">
        {parts.month}
      </span>
    </time>
  );
}

function EventCard({
  occurrence,
  timeZone,
  href,
  onRsvp,
  rsvpPending = false,
  actions = [],
  variant = "list",
  locale,
  className,
}: EventCardProps) {
  const compact = variant === "compact";
  const { canceled } = occurrence;
  const showRsvp = !compact && !canceled && onRsvp !== undefined;
  const recordingUrl = safeLinkHref(occurrence.recordingUrl ?? undefined);

  return (
    <article
      data-slot="event-card"
      data-variant={variant}
      data-canceled={canceled || undefined}
      className={cn(
        "relative flex items-start gap-3 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-bg hover:bg-surface-hover motion-reduce:transition-none",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <EventDateBlock
        startsAt={occurrence.startsAt}
        timeZone={timeZone}
        locale={locale}
        compact={compact}
        muted={canceled}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <h3
            className={cn(
              "min-w-0 flex-1 font-medium",
              compact ? "truncate text-sm" : "text-base",
              canceled ? "text-text-muted line-through" : "text-text",
            )}
          >
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
            >
              {occurrence.title}
            </Link>
          </h3>
          {canceled ? (
            <Badge variant="neutral" className="border-danger text-danger">
              Canceled
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-text-muted">
          <time dateTime={occurrence.startsAt}>
            {formatTimeRange(occurrence.startsAt, occurrence.endsAt, timeZone, locale)}
          </time>
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          {occurrence.recurrence === "weekly" ? (
            <span className="inline-flex items-center gap-1">
              <RepeatIcon className="size-3.5" aria-hidden="true" />
              Weekly
            </span>
          ) : null}
          {!compact && occurrence.locationKind === "link" ? (
            <span className="inline-flex items-center gap-1">
              <VideoIcon className="size-3.5" aria-hidden="true" />
              Online
            </span>
          ) : null}
          {!compact && occurrence.locationKind === "text" ? (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3.5" aria-hidden="true" />
              In person
            </span>
          ) : null}
          {!compact && occurrence.going?.length ? (
            <GoingFaces faces={occurrence.going} size="sm" />
          ) : null}
          <span className="inline-flex items-center gap-1">
            <UsersIcon className="size-3.5" aria-hidden="true" />
            {formatGoingCount(occurrence.goingCount, locale)}
          </span>
          {compact && occurrence.viewerStatus === "going" && !canceled ? (
            <span className="font-medium text-success">You're going</span>
          ) : null}
        </div>
        {recordingUrl && !compact ? (
          <a
            href={recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-(--z-raised) mt-1 inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-accent underline-offset-2 outline-none hover:text-accent-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlayCircleIcon className="size-4" aria-hidden="true" />
            Watch recording
          </a>
        ) : null}
        {showRsvp ? (
          <RsvpControls
            status={occurrence.viewerStatus}
            onRsvp={onRsvp}
            pending={rsvpPending}
            eventTitle={occurrence.title}
            className="z-(--z-raised) mt-2"
          />
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="relative z-(--z-raised) -m-2 self-start">
          <ItemActionsMenu actions={actions} label={`Actions for ${occurrence.title}`} />
        </div>
      ) : null}
    </article>
  );
}

interface EventCardSkeletonProps {
  variant?: EventCardVariant;
  className?: string;
}

function EventCardSkeleton({ variant = "list", className }: EventCardSkeletonProps) {
  const compact = variant === "compact";
  return (
    <div
      data-slot="event-card-skeleton"
      aria-hidden="true"
      className={cn(
        "flex items-start gap-3 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow)",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <Skeleton className={cn("shrink-0", compact ? "h-15 w-12" : "h-18 w-16")} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-24" />
        {compact ? null : <Skeleton className="mt-1 h-8 w-44" />}
      </div>
    </div>
  );
}

export {
  EventCard,
  EventCardSkeleton,
  EventDateBlock,
  type EventCardProps,
  type EventCardSkeletonProps,
  type EventCardVariant,
};
