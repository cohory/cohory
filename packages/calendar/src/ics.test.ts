import { describe, expect, it } from "vitest";

import { buildIcs, icsSequence, type IcsEvent } from "./ics";

const stamp = new Date("2026-10-18T09:30:00Z");

const series: IcsEvent = {
  eventId: "0192f0a0-0000-7000-8000-00000000e001",
  title: "Weekly call; office hours, part 2",
  description: "Bring questions.\nWe record it.",
  location: "https://meet.example.com/abc",
  startsAtLocal: "2026-10-18T18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 90,
  recurrence: "weekly",
  recurrenceUntil: "2026-11-08",
  canceledStarts: [new Date("2026-10-25T17:00:00Z")],
};

function lines(ics: string): string[] {
  return ics.split("\r\n").filter((line) => line.length > 0);
}

function unfold(ics: string): string[] {
  return lines(ics.replace(/\r\n[ \t]/g, ""));
}

describe("buildIcs", () => {
  const ics = buildIcs({ event: series, url: "http://localhost:3000/c/dev/calendar", now: stamp });

  it("uses CRLF line endings, folds lines at 75 octets, and balances components", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    for (const line of lines(ics)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    const all = unfold(ics);
    for (const component of ["VCALENDAR", "VEVENT", "VTIMEZONE"]) {
      expect(all.filter((l) => l === `BEGIN:${component}`).length).toBe(
        all.filter((l) => l === `END:${component}`).length,
      );
    }
    expect(all[0]).toBe("BEGIN:VCALENDAR");
    expect(all.at(-1)).toBe("END:VCALENDAR");
    expect(all).toEqual(expect.arrayContaining(["VERSION:2.0", "PRODID:-//cohory//calendar//EN"]));
  });

  it("writes a weekly series with TZID start, RRULE until in UTC, and EXDATE for cancellations", () => {
    const all = unfold(ics);

    expect(all).toEqual(
      expect.arrayContaining([
        "UID:0192f0a0-0000-7000-8000-00000000e001@cohory",
        "DTSTAMP:20261018T093000Z",
        "DTSTART;TZID=Europe/Berlin:20261018T180000",
        "DURATION:PT1H30M",
        "RRULE:FREQ=WEEKLY;UNTIL=20261108T225959Z",
        "EXDATE;TZID=Europe/Berlin:20261025T180000",
        "SUMMARY:Weekly call\\; office hours\\, part 2",
        "DESCRIPTION:Bring questions.\\nWe record it.",
        "LOCATION:https://meet.example.com/abc",
        "URL:http://localhost:3000/c/dev/calendar",
      ]),
    );
  });

  it("defines the referenced time zone with both observances around the change", () => {
    const all = unfold(ics);
    const zone = all.slice(all.indexOf("BEGIN:VTIMEZONE"), all.indexOf("END:VTIMEZONE") + 1);

    expect(zone).toContain("TZID:Europe/Berlin");
    expect(zone).toContain("BEGIN:STANDARD");
    expect(zone).toContain("TZOFFSETFROM:+0200");
    expect(zone).toContain("TZOFFSETTO:+0100");
    expect(zone).toContain("DTSTART:20261025T030000");
    expect(zone).toContain("BEGIN:DAYLIGHT");
  });

  it("keeps the UID stable for the same event across builds", () => {
    const again = buildIcs({ event: series, url: null, now: new Date("2026-11-01T00:00:00Z") });

    expect(unfold(again)).toContain("UID:0192f0a0-0000-7000-8000-00000000e001@cohory");
    expect(unfold(again).some((l) => l.startsWith("URL:"))).toBe(false);
  });

  it("writes an open weekly series without UNTIL and a single occurrence without RRULE", () => {
    const open = unfold(
      buildIcs({
        event: { ...series, recurrenceUntil: null, canceledStarts: [] },
        url: null,
        now: stamp,
      }),
    );
    const single = unfold(
      buildIcs({
        event: { ...series, recurrence: null, recurrenceUntil: null, canceledStarts: [] },
        occurrence: {
          id: "0192f0a0-0000-7000-8000-00000000f001",
          startsAt: new Date("2026-11-01T17:00:00Z"),
        },
        url: null,
        now: stamp,
      }),
    );

    expect(open).toContain("RRULE:FREQ=WEEKLY");
    expect(open.some((l) => l.startsWith("EXDATE"))).toBe(false);
    expect(single.some((l) => l.startsWith("RRULE"))).toBe(false);
    expect(single).toContain("DTSTART;TZID=Europe/Berlin:20261101T180000");
    expect(single).toContain("UID:0192f0a0-0000-7000-8000-00000000f001@cohory");
  });

  it("writes a STANDARD only zone for a zone without daylight saving", () => {
    const tokyo = unfold(
      buildIcs({
        event: { ...series, timeZone: "Asia/Tokyo", canceledStarts: [] },
        url: null,
        now: stamp,
      }),
    );

    expect(tokyo).toContain("TZOFFSETTO:+0900");
    expect(tokyo).not.toContain("BEGIN:DAYLIGHT");
  });

  it("leaves out the location when the caller may not see it", () => {
    const hidden = unfold(
      buildIcs({ event: { ...series, location: null }, url: null, now: stamp }),
    );

    expect(hidden.some((l) => l.startsWith("LOCATION"))).toBe(false);
  });

  const occurrenceId = "0192f0a0-0000-7000-8000-00000000c001";
  const organizer = { name: 'Dev "Club"', email: "events@example.test" };
  const attendee = { name: "Ada\nLovelace", email: "ada@example.test" };

  function invite(method: "REQUEST" | "CANCEL", at: Date): string[] {
    return unfold(
      buildIcs({
        event: series,
        occurrence: { id: occurrenceId, startsAt: series.canceledStarts[0] ?? stamp },
        url: null,
        now: at,
        invite: { organizer, attendee, method, sequence: icsSequence(at) },
      }),
    );
  }

  function sequenceOf(all: string[]): number {
    return Number(all.find((line) => line.startsWith("SEQUENCE:"))?.slice("SEQUENCE:".length));
  }

  it("writes an invite with the organizer and the member as an accepted attendee", () => {
    const all = invite("REQUEST", stamp);

    expect(all).toContain("METHOD:REQUEST");
    expect(all).not.toContain("METHOD:PUBLISH");
    expect(all).toContain(`UID:${occurrenceId}@cohory`);
    expect(all).toContain('ORGANIZER;CN="Dev Club":mailto:events@example.test');
    expect(all).toContain(
      'ATTENDEE;CN="Ada Lovelace";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:ada@example.test',
    );
    expect(all).toContain("STATUS:CONFIRMED");
    expect(sequenceOf(all)).toBe(icsSequence(stamp));
  });

  it("raises the sequence with every later change so calendars take the update", () => {
    const first = invite("REQUEST", stamp);
    const moved = invite("REQUEST", new Date(stamp.getTime() + 60_000));

    expect(sequenceOf(first)).toBeGreaterThan(0);
    expect(sequenceOf(moved)).toBeGreaterThan(sequenceOf(first));
    expect(moved).toContain(`UID:${occurrenceId}@cohory`);
    expect(Number.isSafeInteger(icsSequence(new Date("2037-12-31T23:59:59Z")))).toBe(true);
    expect(icsSequence(new Date("2037-12-31T23:59:59Z"))).toBeLessThan(2 ** 31);
  });

  it("cancels the same calendar entry with a higher sequence", () => {
    const request = invite("REQUEST", stamp);
    const cancel = invite("CANCEL", new Date(stamp.getTime() + 1_000));

    expect(cancel).toContain("METHOD:CANCEL");
    expect(cancel).not.toContain("METHOD:REQUEST");
    expect(cancel).toContain("STATUS:CANCELLED");
    expect(cancel).toContain(`UID:${occurrenceId}@cohory`);
    expect(cancel).toContain('ORGANIZER;CN="Dev Club":mailto:events@example.test');
    expect(
      cancel.some((line) => line.startsWith("ATTENDEE") && line.endsWith("ada@example.test")),
    ).toBe(true);
    expect(cancel.some((line) => line.startsWith("LOCATION"))).toBe(false);
    expect(sequenceOf(cancel)).toBeGreaterThan(sequenceOf(request));
  });
});
