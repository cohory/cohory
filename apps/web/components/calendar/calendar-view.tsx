"use client";

import {
  CalendarMonth,
  CalendarViewSwitch,
  EventCard,
  EventList,
  type CalendarView,
  type EventOccurrence,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { calendarHref, occurrenceHref } from "../../lib/calendar/hrefs";
import { groupByDay, inMonth, onDay } from "../../lib/calendar/views";
import { useRsvp } from "./use-rsvp";

interface CalendarViewProps {
  slug: string;
  view: CalendarView | null;
  month: string;
  timeZone: string;
  monthOccurrences: EventOccurrence[] | null;
  listOccurrences: EventOccurrence[] | null;
  pastOccurrences: EventOccurrence[];
  canRsvp: boolean;
}

export function CalendarPageView(props: CalendarViewProps) {
  const { slug, view, month, timeZone, canRsvp } = props;
  const router = useRouter();
  const { apply, rsvp, pendingId } = useRsvp(slug);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const navigate = (next: { view: CalendarView; month?: string }) => {
    router.push(calendarHref(slug, { view: next.view, month: next.month ?? month }), {
      scroll: false,
    });
  };
  const eventHref = (occurrence: EventOccurrence) =>
    occurrenceHref(slug, occurrence.eventSlug, occurrence.id);
  const onRsvp = canRsvp ? rsvp : undefined;

  const list = (occurrences: EventOccurrence[]) => (
    <EventList
      groups={groupByDay(occurrences.map(apply), timeZone)}
      timeZone={timeZone}
      eventHref={eventHref}
      onRsvp={onRsvp}
      rsvpPendingId={pendingId}
    />
  );

  const past =
    props.pastOccurrences.length > 0 ? (
      <section aria-labelledby="past-events-heading" className="flex flex-col gap-3">
        <h3 id="past-events-heading" className="text-base font-semibold text-text">
          Past events
        </h3>
        <ul className="flex flex-col gap-3">
          {props.pastOccurrences.map((occurrence) => (
            <li key={occurrence.id}>
              <EventCard occurrence={occurrence} timeZone={timeZone} href={eventHref(occurrence)} />
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const next = props.listOccurrences?.find((occurrence) => !occurrence.canceled);
  const nextSection = next ? (
    <section aria-labelledby="next-event-heading" className="flex flex-col gap-3">
      <h3 id="next-event-heading" className="text-base font-semibold text-text">
        Next event
      </h3>
      <EventCard
        occurrence={apply(next)}
        timeZone={timeZone}
        href={eventHref(next)}
        onRsvp={onRsvp ? (status) => onRsvp(apply(next), status) : undefined}
        rsvpPending={pendingId === next.id}
      />
    </section>
  ) : null;

  const monthOccurrences = props.monthOccurrences;
  const monthSection = monthOccurrences ? (
    <div className="flex flex-col gap-4">
      <CalendarViewSwitch view="month" onChange={(next) => navigate({ view: next })} />
      <CalendarMonth
        month={month}
        occurrences={monthOccurrences.map(apply)}
        timeZone={timeZone}
        selectedDay={selectedDay}
        onSelectDay={(day) => setSelectedDay((current) => (current === day ? null : day))}
        onMonthChange={(next) => {
          setSelectedDay(null);
          navigate({ view: "month", month: next });
        }}
      />
      {list(
        selectedDay
          ? onDay(monthOccurrences, selectedDay, timeZone)
          : inMonth(monthOccurrences, month, timeZone),
      )}
    </div>
  ) : null;

  const listSection = props.listOccurrences ? (
    <div className="flex flex-col gap-4">
      <CalendarViewSwitch view="list" onChange={(next) => navigate({ view: next })} />
      {list(props.listOccurrences)}
    </div>
  ) : null;

  if (view === "month") return monthSection;
  if (view === "list") {
    return (
      <div className="flex flex-col gap-8">
        {listSection}
        {past}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <div className="hidden flex-col gap-8 md:flex">
        {nextSection}
        {monthSection}
      </div>
      <div className="md:hidden">{listSection}</div>
      {past}
    </div>
  );
}
