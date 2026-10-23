import type { Recurrence } from "./occurrences";
import {
  addDays,
  offsetMinutes,
  parseCalendarDate,
  parseWallClock,
  toInstant,
  toWallClock,
  type WallClock,
} from "./wall-clock";

export interface IcsEvent {
  readonly eventId: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly startsAtLocal: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly recurrence: Recurrence | null;
  readonly recurrenceUntil: string | null;
  readonly canceledStarts: readonly Date[];
}

export interface IcsPerson {
  readonly name: string;
  readonly email: string;
}

export type IcsMethod = "REQUEST" | "CANCEL";

export interface IcsInvite {
  readonly organizer: IcsPerson;
  readonly attendee: IcsPerson;
  readonly method: IcsMethod;
  readonly sequence: number;
}

// Seconds since 2024 keep SEQUENCE within a signed 32 bit integer, which some calendar clients
// assume, for decades. Each message is stamped when its job reads the state it describes, so a
// message describing newer state always carries a higher sequence.
const sequenceEpoch = Date.UTC(2024, 0, 1);

export function icsSequence(at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - sequenceEpoch) / 1000));
}

export interface IcsInput {
  readonly event: IcsEvent;
  readonly occurrence?: { readonly id: string; readonly startsAt: Date };
  readonly url: string | null;
  readonly now: Date;
  readonly invite?: IcsInvite;
}

function commonName(name: string): string {
  return name
    .replace(/[\p{Cc}"]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inviteLines({ organizer, attendee, method, sequence }: IcsInvite): string[] {
  const cancel = method === "CANCEL";
  return [
    `ORGANIZER;CN="${commonName(organizer.name)}":mailto:${organizer.email}`,
    `ATTENDEE;CN="${commonName(attendee.name)}";ROLE=REQ-PARTICIPANT;${cancel ? "" : "PARTSTAT=ACCEPTED;"}RSVP=FALSE:mailto:${attendee.email}`,
    `SEQUENCE:${sequence}`,
    cancel ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
  ];
}

const dayMs = 86_400_000;
const openSeriesZoneYears = 2;

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

function localStamp(clock: WallClock, seconds = 0): string {
  return `${pad(clock.year, 4)}${pad(clock.month)}${pad(clock.day)}T${pad(clock.hour)}${pad(clock.minute)}${pad(seconds)}`;
}

function utcStamp(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;
}

function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 || hours === 0 ? `${rest}M` : ""}`;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

interface Transition {
  readonly at: Date;
  readonly from: number;
  readonly to: number;
}

function findTransitions(timeZone: string, start: Date, end: Date): Transition[] {
  const transitions: Transition[] = [];
  let previous = start.getTime();
  let previousOffset = offsetMinutes(timeZone, start);
  for (let time = previous + dayMs; time <= end.getTime() + dayMs; time += dayMs) {
    const offset = offsetMinutes(timeZone, new Date(time));
    if (offset !== previousOffset) {
      let low = previous;
      let high = time;
      while (high - low > 60_000) {
        const middle = low + Math.floor((high - low) / 120_000) * 60_000;
        if (offsetMinutes(timeZone, new Date(middle)) === previousOffset) {
          low = middle;
        } else {
          high = middle;
        }
      }
      transitions.push({ at: new Date(high), from: previousOffset, to: offset });
      previousOffset = offset;
    }
    previous = time;
  }
  return transitions;
}

function timeZoneLines(timeZone: string, start: Date, end: Date): string[] {
  const transitions = findTransitions(timeZone, new Date(start.getTime() - 366 * dayMs), end);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (transitions.length === 0) {
    const offset = offsetText(offsetMinutes(timeZone, start));
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      "END:STANDARD",
    );
  }
  for (const transition of transitions) {
    const kind = transition.to > transition.from ? "DAYLIGHT" : "STANDARD";
    const wall = toWallClock(new Date(transition.at.getTime() + transition.from * 60_000), "UTC");
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${localStamp(wall)}`,
      `TZOFFSETFROM:${offsetText(transition.from)}`,
      `TZOFFSETTO:${offsetText(transition.to)}`,
      `END:${kind}`,
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

function ruleClock(event: IcsEvent): WallClock {
  const clock = parseWallClock(event.startsAtLocal);
  if (!clock) {
    throw new Error("invalid wall clock start");
  }
  return clock;
}

function occurrenceClock(event: IcsEvent, startsAt: Date): WallClock {
  const rule = ruleClock(event);
  const local = toWallClock(startsAt, event.timeZone);
  return { ...local, hour: rule.hour, minute: rule.minute };
}

export function buildIcs({ event, occurrence, url, now, invite }: IcsInput): string {
  const series = occurrence === undefined && event.recurrence === "weekly";
  const startClock = occurrence
    ? toWallClock(occurrence.startsAt, event.timeZone)
    : ruleClock(event);
  const startInstant = toInstant(startClock, event.timeZone);
  const until = series && event.recurrenceUntil ? parseCalendarDate(event.recurrenceUntil) : null;
  const untilInstant = until
    ? new Date(toInstant({ ...until, hour: 23, minute: 59 }, event.timeZone).getTime() + 59_000)
    : null;
  const zoneEnd = series
    ? (untilInstant ?? toInstant(addDays(startClock, 366 * openSeriesZoneYears), event.timeZone))
    : new Date(startInstant.getTime() + dayMs);

  const body = [
    "BEGIN:VEVENT",
    `UID:${occurrence ? occurrence.id : event.eventId}@cohory`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${event.timeZone}:${localStamp(startClock)}`,
    `DURATION:${durationText(event.durationMinutes)}`,
  ];
  if (series) {
    body.push(`RRULE:FREQ=WEEKLY${untilInstant ? `;UNTIL=${utcStamp(untilInstant)}` : ""}`);
    for (const canceled of event.canceledStarts) {
      body.push(`EXDATE;TZID=${event.timeZone}:${localStamp(occurrenceClock(event, canceled))}`);
    }
  }
  body.push(`SUMMARY:${escapeText(event.title)}`);
  const details = invite?.method !== "CANCEL";
  if (details && event.description) {
    body.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (details && event.location) {
    body.push(`LOCATION:${escapeText(event.location)}`);
  }
  if (url) {
    body.push(`URL:${url}`);
  }
  if (invite) {
    body.push(...inviteLines(invite));
  }
  body.push("END:VEVENT");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//cohory//calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${invite?.method ?? "PUBLISH"}`,
    ...timeZoneLines(event.timeZone, startInstant, zoneEnd),
    ...body,
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
