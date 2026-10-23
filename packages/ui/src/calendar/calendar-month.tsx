"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import {
  addDays,
  addMonths,
  dateKey,
  formatDayKey,
  formatMonthLabel,
  monthGrid,
  weekdayLabels,
  type CalendarDay,
  type WeekStart,
} from "./time";
import type { EventOccurrence } from "./types";

const MAX_MARKERS = 3;

interface CalendarMonthProps {
  month: string;
  occurrences: EventOccurrence[];
  timeZone: string;
  onMonthChange(month: string): void;
  onSelectDay?(date: string): void;
  selectedDay?: string | null;
  renderDay?(day: CalendarDay, occurrences: EventOccurrence[]): ReactNode;
  weekStartsOn?: WeekStart;
  now?: Date;
  locale?: string;
  className?: string;
}

function eventCountLabel(count: number): string {
  if (count === 0) return "No events";
  return count === 1 ? "1 event" : `${count} events`;
}

function dayLabel(
  date: string,
  occurrences: EventOccurrence[],
  isToday: boolean,
  locale?: string,
): string {
  const summary = [
    formatDayKey(date, locale),
    isToday ? "today" : null,
    eventCountLabel(occurrences.length),
  ]
    .filter(Boolean)
    .join(", ");
  if (occurrences.length === 0) return summary;
  const titles = occurrences.map((occurrence) =>
    occurrence.canceled ? `${occurrence.title} (canceled)` : occurrence.title,
  );
  return `${summary}: ${titles.join(", ")}`;
}

function keyboardTarget(date: string, key: string, weekStartsOn: WeekStart): string | null {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const fromWeekStart = (weekday - weekStartsOn + 7) % 7;
  switch (key) {
    case "ArrowLeft":
      return addDays(date, -1);
    case "ArrowRight":
      return addDays(date, 1);
    case "ArrowUp":
      return addDays(date, -7);
    case "ArrowDown":
      return addDays(date, 7);
    case "Home":
      return addDays(date, -fromWeekStart);
    case "End":
      return addDays(date, 6 - fromWeekStart);
    case "PageUp":
    case "PageDown": {
      const month = addMonths(date.slice(0, 7), key === "PageUp" ? -1 : 1);
      const lastDay = Number(addDays(`${addMonths(month, 1)}-01`, -1).slice(8));
      const day = Math.min(Number(date.slice(8)), lastDay);
      return `${month}-${String(day).padStart(2, "0")}`;
    }
    default:
      return null;
  }
}

function DayMarkers({ occurrences }: { occurrences: EventOccurrence[] }) {
  if (occurrences.length === 0) return null;
  const visible = occurrences.slice(0, MAX_MARKERS);
  const overflow = occurrences.length - visible.length;
  return (
    <div aria-hidden="true" className="flex w-full min-w-0 flex-col gap-0.5">
      <div className="flex items-center gap-1 sm:hidden">
        {visible.map((occurrence) => (
          <span
            key={occurrence.id}
            className={cn(
              "size-1.5 rounded-full",
              occurrence.canceled ? "bg-text-subtle" : "bg-accent",
            )}
          />
        ))}
      </div>
      <ul className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {visible.map((occurrence) => (
          <li
            key={occurrence.id}
            className={cn(
              "truncate rounded-sm px-1 text-left text-xs",
              occurrence.canceled ? "text-text-muted line-through" : "bg-accent-muted text-text",
            )}
          >
            {occurrence.title}
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <span data-slot="calendar-overflow" className="text-left text-xs text-text-muted">
          {`+${overflow}`}
        </span>
      ) : null}
    </div>
  );
}

function CalendarMonth({
  month,
  occurrences,
  timeZone,
  onMonthChange,
  onSelectDay,
  selectedDay,
  renderDay,
  weekStartsOn = 1,
  now,
  locale,
  className,
}: CalendarMonthProps) {
  const headingId = useId();
  const gridRef = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [initialNow] = useState(() => now ?? new Date());
  const today = dateKey((now ?? initialNow).toISOString(), timeZone);

  const rows = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);
  const weekdays = useMemo(() => weekdayLabels(weekStartsOn, locale), [weekStartsOn, locale]);
  const byDay = useMemo(() => {
    const map = new Map<string, EventOccurrence[]>();
    const sorted = [...occurrences].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const occurrence of sorted) {
      const key = dateKey(occurrence.startsAt, timeZone);
      map.set(key, [...(map.get(key) ?? []), occurrence]);
    }
    return map;
  }, [occurrences, timeZone]);

  const fallback = selectedDay?.startsWith(month)
    ? selectedDay
    : today.startsWith(month)
      ? today
      : `${month}-01`;
  const activeDate = focused?.startsWith(month) ? focused : fallback;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${activeDate}"]`)?.focus();
  }, [activeDate]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = keyboardTarget(date, event.key, weekStartsOn);
    if (!next) return;
    event.preventDefault();
    moveFocus.current = true;
    setFocused(next);
    const nextMonth = next.slice(0, 7);
    if (nextMonth !== month) onMonthChange(nextMonth);
  }

  function goToday() {
    setFocused(today);
    const todayMonth = today.slice(0, 7);
    if (todayMonth !== month) onMonthChange(todayMonth);
  }

  return (
    <section data-slot="calendar-month" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <h2 id={headingId} aria-live="polite" className="flex-1 text-xl font-semibold text-text">
          {formatMonthLabel(month, locale)}
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={goToday}>
          Today
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={headingId}
        className="w-full table-fixed border-collapse overflow-hidden rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow)"
      >
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday.long}
                scope="col"
                abbr={weekday.long}
                className="py-2 text-xs font-medium text-text-muted"
              >
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]?.date}>
              {row.map((day) => {
                const dayOccurrences = byDay.get(day.date) ?? [];
                const isToday = day.date === today;
                const isSelected = day.date === selectedDay;
                return (
                  <td
                    key={day.date}
                    role="gridcell"
                    aria-selected={isSelected}
                    className="h-16 border border-border p-0 align-top sm:h-24"
                  >
                    <button
                      type="button"
                      data-date={day.date}
                      tabIndex={day.date === activeDate ? 0 : -1}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => {
                        setFocused(day.date);
                        onSelectDay?.(day.date);
                      }}
                      onKeyDown={(event) => onKeyDown(event, day.date)}
                      className={cn(
                        "flex size-full min-h-11 flex-col items-start gap-1 p-1 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none",
                        isSelected && "bg-accent-muted hover:bg-accent-muted",
                        !day.inMonth && "text-text-muted",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
                          isToday ? "bg-accent font-semibold text-accent-foreground" : null,
                        )}
                      >
                        {day.day}
                      </span>
                      <span className="sr-only">
                        {dayLabel(day.date, dayOccurrences, isToday, locale)}
                      </span>
                      {renderDay ? (
                        <div aria-hidden="true" className="w-full min-w-0">
                          {renderDay(day, dayOccurrences)}
                        </div>
                      ) : (
                        <DayMarkers occurrences={dayOccurrences} />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export { CalendarMonth, type CalendarMonthProps };
