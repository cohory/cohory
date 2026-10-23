"use client";

import {
  CalendarIcon,
  CalendarPlusIcon,
  ClockIcon,
  MapPinIcon,
  PlayCircleIcon,
  RepeatIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { safeLinkHref } from "../community/content";
import { ItemActionsMenu, type ItemAction } from "../community/item-actions";
import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import { GoingFaces } from "./going-faces";
import { RsvpControls } from "./rsvp-controls";
import { repeatLine } from "./schedule-summary";
import {
  durationMinutes,
  formatDateLong,
  formatDateOnly,
  formatDuration,
  formatGoingCount,
  formatTimeRange,
  JOIN_WINDOW_MINUTES,
  occurrencePhase,
} from "./time";
import type { EventLocation, EventOccurrence, RsvpStatus } from "./types";

interface EventDetailEvent {
  description: string;
  timeZone: string;
  location?: EventLocation | null;
  recordingUrl?: string | null;
  recurrenceUntil?: string | null;
  coverUrl?: string | null;
}

interface EventDetailProps {
  occurrence: EventOccurrence;
  event: EventDetailEvent;
  viewerTimeZone: string;
  icsHref: string;
  onRsvp?(status: RsvpStatus): void;
  rsvpPending?: boolean;
  actions?: ItemAction[];
  primaryAction?: ReactNode;
  now?: Date;
  locale?: string;
  className?: string;
}

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm text-text">
      <span aria-hidden="true" className="mt-0.5 text-text-muted [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

function whenLine(occurrence: EventOccurrence, timeZone: string, locale?: string): string {
  return `${formatDateLong(occurrence.startsAt, timeZone, locale)}, ${formatTimeRange(
    occurrence.startsAt,
    occurrence.endsAt,
    timeZone,
    locale,
  )}`;
}

function EventDetail({
  occurrence,
  event,
  viewerTimeZone,
  icsHref,
  onRsvp,
  rsvpPending = false,
  actions = [],
  primaryAction,
  now,
  locale,
  className,
}: EventDetailProps) {
  const [initialNow] = useState(() => now ?? new Date());
  const phase = occurrencePhase(occurrence.startsAt, occurrence.endsAt, now ?? initialNow);
  const { canceled } = occurrence;
  const viewerWhen = whenLine(occurrence, viewerTimeZone, locale);
  const eventWhen = whenLine(occurrence, event.timeZone, locale);
  const joinUrl = event.location?.kind === "link" ? safeLinkHref(event.location.url) : null;
  const canJoin = !canceled && joinUrl !== null && (phase === "joinable" || phase === "live");
  const recordingUrl = safeLinkHref(event.recordingUrl ?? undefined);
  const showRsvp = onRsvp !== undefined && !canceled && phase !== "past";
  const rsvpEmphasis = canJoin || primaryAction ? "secondary" : "primary";

  return (
    <article data-slot="event-detail" className={cn("flex flex-col gap-6", className)}>
      {canceled ? (
        <Alert variant="danger">
          <AlertTitle>This event was canceled</AlertTitle>
          <AlertDescription>
            It won't take place on {formatDateLong(occurrence.startsAt, viewerTimeZone, locale)}.
          </AlertDescription>
        </Alert>
      ) : null}
      {event.coverUrl ? (
        <img
          src={event.coverUrl}
          alt=""
          data-slot="event-cover"
          className="aspect-video w-full rounded-(--card-radius) border border-border object-cover"
        />
      ) : null}
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1
            className={cn(
              "text-2xl font-semibold",
              canceled ? "text-text-muted line-through" : "text-text",
            )}
          >
            {occurrence.title}
          </h1>
          {phase === "live" && !canceled ? (
            <Badge variant="success" className="self-start">
              Live now
            </Badge>
          ) : null}
        </div>
        <ItemActionsMenu actions={actions} label={`Actions for ${occurrence.title}`} />
      </header>

      <div className="flex flex-col gap-3">
        <DetailRow icon={<CalendarIcon />}>
          <time dateTime={occurrence.startsAt} className="font-medium">
            {viewerWhen}
          </time>
          {eventWhen !== viewerWhen ? (
            <span className="text-text-muted">Event time: {eventWhen}</span>
          ) : null}
        </DetailRow>
        <DetailRow icon={<ClockIcon />}>
          <span>{formatDuration(durationMinutes(occurrence.startsAt, occurrence.endsAt))}</span>
        </DetailRow>
        {occurrence.recurrence === "weekly" ? (
          <DetailRow icon={<RepeatIcon />}>
            <span>
              {repeatLine(
                occurrence.startsAt,
                event.timeZone,
                event.recurrenceUntil ? formatDateOnly(event.recurrenceUntil, locale) : null,
              )}
            </span>
          </DetailRow>
        ) : null}
        {event.location?.kind === "link" ? (
          <DetailRow icon={<VideoIcon />}>
            <span>Online</span>
            {canJoin ? null : (
              <span className="break-all text-text-muted">{event.location.url}</span>
            )}
            {!canJoin && !canceled && phase === "upcoming" ? (
              <span className="text-text-muted">
                The Join call button appears {JOIN_WINDOW_MINUTES} minutes before the start.
              </span>
            ) : null}
          </DetailRow>
        ) : null}
        {event.location?.kind === "text" ? (
          <DetailRow icon={<MapPinIcon />}>
            <span className="whitespace-pre-line break-words">{event.location.text}</span>
          </DetailRow>
        ) : null}
        <DetailRow icon={<UsersIcon />}>
          <div className="flex flex-wrap items-center gap-2">
            <GoingFaces faces={occurrence.going ?? []} />
            <span>{formatGoingCount(occurrence.goingCount, locale)}</span>
          </div>
        </DetailRow>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canJoin && joinUrl ? (
          <Button asChild>
            <a href={joinUrl} target="_blank" rel="noopener noreferrer">
              <VideoIcon className="size-4" aria-hidden="true" />
              Join call
            </a>
          </Button>
        ) : null}
        {primaryAction}
        {showRsvp ? (
          <RsvpControls
            status={occurrence.viewerStatus}
            onRsvp={onRsvp}
            pending={rsvpPending}
            emphasis={rsvpEmphasis}
            size="md"
          />
        ) : null}
        {canceled ? null : (
          <Button asChild variant="secondary">
            <a href={icsHref} download>
              <CalendarPlusIcon className="size-4" aria-hidden="true" />
              Add to calendar
            </a>
          </Button>
        )}
        {recordingUrl ? (
          <Button asChild variant="secondary">
            <a href={recordingUrl} target="_blank" rel="noopener noreferrer">
              <PlayCircleIcon className="size-4" aria-hidden="true" />
              Watch recording
            </a>
          </Button>
        ) : null}
      </div>

      {event.description.trim() ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-text">About this event</h2>
          <p className="text-base whitespace-pre-line break-words text-text">{event.description}</p>
        </section>
      ) : null}
    </article>
  );
}

export { EventDetail, type EventDetailEvent, type EventDetailProps };
