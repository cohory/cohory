import { describe, expect, it } from "vitest";

import { toFieldErrors } from "./errors";
import { createEventSchema, eventValuesSchema, recordingSchema, toServiceInput } from "./schemas";

const valid = {
  title: "Weekly call",
  description: "",
  date: "2026-11-03",
  time: "18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: null,
  recurrenceUntil: "",
  location: "https://meet.example.com/call",
};

function messagesFor(input: unknown, field: string): string[] {
  const parsed = eventValuesSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((issue) => issue.path.at(-1) === field)
    .map((issue) => issue.message);
}

describe("event action validation", () => {
  it("accepts a single event with a valid IANA time zone", () => {
    expect(eventValuesSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["Mars/Olympus", "CET+1", "+05:00", "", "Europe/Berlin; drop"])(
    "rejects %j as a time zone",
    (timeZone) => {
      expect(messagesFor({ ...valid, timeZone }, "timeZone")).toEqual([
        "Pick a time zone from the list.",
      ]);
    },
  );

  it("rejects durations outside 5 minutes to 24 hours", () => {
    expect(messagesFor({ ...valid, durationMinutes: 4 }, "durationMinutes")).toEqual([
      "An event lasts at least 5 minutes.",
    ]);
    expect(messagesFor({ ...valid, durationMinutes: 1441 }, "durationMinutes")).toEqual([
      "An event lasts at most 24 hours.",
    ]);
    expect(messagesFor({ ...valid, durationMinutes: 30.5 }, "durationMinutes")).toEqual([
      "Use whole minutes.",
    ]);
    expect(eventValuesSchema.safeParse({ ...valid, durationMinutes: 1440 }).success).toBe(true);
    expect(eventValuesSchema.safeParse({ ...valid, durationMinutes: 5 }).success).toBe(true);
  });

  it("requires the series end date to fall after the first date", () => {
    const weekly = { ...valid, recurrence: "weekly" };
    expect(messagesFor({ ...weekly, recurrenceUntil: "2026-11-03" }, "recurrenceUntil")).toEqual([
      "The end date must be after the first date.",
    ]);
    expect(messagesFor({ ...weekly, recurrenceUntil: "2026-10-01" }, "recurrenceUntil")).toEqual([
      "The end date must be after the first date.",
    ]);
    expect(eventValuesSchema.safeParse({ ...weekly, recurrenceUntil: "2026-11-04" }).success).toBe(
      true,
    );
    expect(eventValuesSchema.safeParse({ ...weekly, recurrenceUntil: "" }).success).toBe(true);
  });

  it("rejects an end date on a single event", () => {
    expect(messagesFor({ ...valid, recurrenceUntil: "2026-12-01" }, "recurrenceUntil")).toEqual([
      "Only a weekly event can have an end date.",
    ]);
  });

  it("rejects impossible dates and times", () => {
    expect(messagesFor({ ...valid, date: "2026-02-30" }, "date")).toEqual(["Pick a date."]);
    expect(messagesFor({ ...valid, time: "24:00" }, "time")).toEqual(["Pick a start time."]);
  });

  it("requires a community slug next to the values", () => {
    expect(createEventSchema.safeParse({ slug: "Bad Slug", values: valid }).success).toBe(false);
    expect(createEventSchema.safeParse({ slug: "yoga", values: valid }).success).toBe(true);
  });

  it("maps form values to the calendar service input", () => {
    const values = eventValuesSchema.parse({
      ...valid,
      location: "  ",
      recurrence: "weekly",
      recurrenceUntil: "2027-01-05",
    });
    expect(toServiceInput(values)).toEqual({
      title: "Weekly call",
      description: null,
      startsAtLocal: "2026-11-03T18:00",
      timeZone: "Europe/Berlin",
      durationMinutes: 60,
      recurrence: "weekly",
      recurrenceUntil: "2027-01-05",
      location: null,
      coverKey: null,
    });
  });

  it("passes the cover key through and only lets create ask to notify members", () => {
    const values = eventValuesSchema.parse({ ...valid, coverKey: "communities/c1/cover.png" });
    expect(toServiceInput(values).coverKey).toBe("communities/c1/cover.png");
    expect(createEventSchema.parse({ slug: "yoga", values: valid }).notifyMembers).toBe(false);
    expect(
      createEventSchema.parse({ slug: "yoga", values: valid, notifyMembers: true }).notifyMembers,
    ).toBe(true);
  });

  it("accepts an empty recording link and rejects other schemes", () => {
    const base = { slug: "yoga", eventSlug: "call" };
    expect(recordingSchema.safeParse({ ...base, recordingUrl: "" }).success).toBe(true);
    expect(
      recordingSchema.safeParse({ ...base, recordingUrl: "https://v.example/1" }).success,
    ).toBe(true);
    expect(
      recordingSchema.safeParse({ ...base, recordingUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("maps service issue paths onto form fields", () => {
    expect(
      toFieldErrors([
        { path: "startsAtLocal", message: "Bad start." },
        { path: "values.recurrenceUntil", message: "Bad end." },
        { path: "occurrenceId", message: "Gone." },
      ]),
    ).toEqual({ date: "Bad start.", recurrenceUntil: "Bad end.", form: "Gone." });
  });
});
