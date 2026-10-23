"use client";

import { CalendarIcon, PlusIcon } from "lucide-react";
import { useId } from "react";

import type { ItemAction } from "../community/item-actions";
import { EmptyState } from "../community/empty-state";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import { EventCard, EventCardSkeleton } from "./event-card";
import type { EventOccurrence, RsvpStatus } from "./types";

interface EventListGroup {
  dateLabel: string;
  occurrences: EventOccurrence[];
}

type CreateEventAction = { href: string; onSelect?: never } | { onSelect(): void; href?: never };

interface EventListProps {
  groups: EventListGroup[];
  timeZone: string;
  eventHref(occurrence: EventOccurrence): string;
  onRsvp?(occurrence: EventOccurrence, status: RsvpStatus): void;
  rsvpPendingId?: string | null;
  actionsFor?(occurrence: EventOccurrence): ItemAction[];
  createAction?: CreateEventAction;
  locale?: string;
  className?: string;
}

function CreateEventButton({ action }: { action: CreateEventAction }) {
  const content = (
    <>
      <PlusIcon className="size-4" aria-hidden="true" />
      Create an event
    </>
  );
  if (action.href !== undefined) {
    return (
      <Button asChild>
        <a href={action.href}>{content}</a>
      </Button>
    );
  }
  return (
    <Button type="button" onClick={action.onSelect}>
      {content}
    </Button>
  );
}

function EventListGroupSection({ group, list }: { group: EventListGroup; list: EventListProps }) {
  const headingId = useId();
  const { onRsvp } = list;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-medium text-text-muted">
        {group.dateLabel}
      </h3>
      <ul className="flex flex-col gap-2">
        {group.occurrences.map((occurrence) => (
          <li key={occurrence.id}>
            <EventCard
              occurrence={occurrence}
              timeZone={list.timeZone}
              href={list.eventHref(occurrence)}
              onRsvp={onRsvp ? (status) => onRsvp(occurrence, status) : undefined}
              rsvpPending={list.rsvpPendingId === occurrence.id}
              actions={list.actionsFor?.(occurrence)}
              locale={list.locale}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventList(props: EventListProps) {
  const groups = props.groups.filter((group) => group.occurrences.length > 0);
  if (groups.length === 0) {
    return (
      <EmptyState
        className={props.className}
        icon={<CalendarIcon />}
        title="No upcoming events"
        description={props.createAction ? "Schedule a call or meetup for your members." : undefined}
        action={props.createAction ? <CreateEventButton action={props.createAction} /> : undefined}
      />
    );
  }
  return (
    <div data-slot="event-list" className={cn("flex flex-col gap-6", props.className)}>
      {groups.map((group) => (
        <EventListGroupSection key={group.dateLabel} group={group} list={props} />
      ))}
    </div>
  );
}

function EventListSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <EventCardSkeleton key={index} />
      ))}
    </div>
  );
}

export {
  EventList,
  EventListSkeleton,
  type CreateEventAction,
  type EventListGroup,
  type EventListProps,
};
