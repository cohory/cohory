import { dateKey, formatDateLong, formatDuration, formatTime, zoneAbbreviation } from "./time";
import { zoneCity, zoneInstant } from "./time-zones";
import type { EventRecurrence } from "./types";

interface ScheduleFields {
  date: string;
  time: string;
  timeZone: string;
  recurrence: EventRecurrence | null;
}

function weekday(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(new Date(iso));
}

function scheduleSummary(fields: ScheduleFields, viewerTimeZone?: string): string | null {
  const start = zoneInstant(fields.date, fields.time, fields.timeZone);
  if (!start) return null;
  const iso = start.toISOString();
  const zone = fields.timeZone;
  const clock = `${formatTime(iso, zone)} ${zoneAbbreviation(zone, iso)}`;
  const event =
    fields.recurrence === "weekly"
      ? `Every ${weekday(iso, zone)}, ${clock}`
      : `${formatDateLong(iso, zone)}, ${clock}`;
  if (!viewerTimeZone) return event;
  const viewerTime = formatTime(iso, viewerTimeZone);
  const sameDay = dateKey(iso, zone) === dateKey(iso, viewerTimeZone);
  if (sameDay && viewerTime === formatTime(iso, zone)) return event;
  const yours = sameDay ? viewerTime : `${weekday(iso, viewerTimeZone)} ${viewerTime}`;
  return `${event} (${yours} for you)`;
}

interface WallClock {
  date: string;
  time: string;
}

interface ZoneChange {
  keepClock: { label: string; value: WallClock };
  keepMoment: { label: string; value: WallClock };
}

function zoneChange(
  baseline: WallClock & { timeZone: string },
  timeZone: string,
): ZoneChange | null {
  if (baseline.timeZone === timeZone) return null;
  const original = zoneInstant(baseline.date, baseline.time, baseline.timeZone);
  const moved = zoneInstant(baseline.date, baseline.time, timeZone);
  if (!original || !moved) return null;
  const minutes = Math.round((moved.getTime() - original.getTime()) / 60_000);
  if (minutes === 0) return null;
  const city = zoneCity(timeZone);
  const iso = original.toISOString();
  const moment = { date: dateKey(iso, timeZone), time: formatTime(iso, timeZone) };
  const direction = minutes > 0 ? "later" : "earlier";
  return {
    keepClock: {
      label: `Keep ${baseline.time} in ${city} (moves the event ${formatDuration(Math.abs(minutes))} ${direction})`,
      value: { date: baseline.date, time: baseline.time },
    },
    keepMoment: {
      label: `Keep the same moment (${moment.time} in ${city})`,
      value: moment,
    },
  };
}

function repeatLine(startISO: string, timeZone: string, untilLabel: string | null): string {
  const every = `Every ${weekday(startISO, timeZone)}`;
  return untilLabel ? `${every} until ${untilLabel}` : every;
}

export { repeatLine, scheduleSummary, zoneChange, type ZoneChange };
