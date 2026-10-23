import { describe, expect, it } from "vitest";

import { timeChangeJobPayloadSchema } from "./time-change";

const payload = {
  communityId: "0192f0a0-0000-7000-8000-00000000c001",
  eventId: "0192f0a0-0000-7000-8000-00000000e001",
  editorId: null,
  changedAt: "2026-10-18T10:00:00.000Z",
  previousZone: "Europe/Berlin",
  baseline: [
    {
      occurrenceId: "0192f0a0-0000-7000-8000-00000000a001",
      previousStart: "2026-10-18T16:00:00.000Z",
    },
  ],
  removals: [
    {
      userId: "0192f0a0-0000-7000-8000-00000000b001",
      starts: ["2026-11-08T17:00:00.000Z"],
    },
  ],
};

describe("timeChangeJobPayloadSchema", () => {
  it("reads every date back as a date after a JSON round trip", () => {
    const parsed = timeChangeJobPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));

    expect(parsed.changedAt).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(parsed.baseline[0]?.previousStart).toEqual(new Date("2026-10-18T16:00:00.000Z"));
    expect(parsed.removals[0]?.starts).toEqual([new Date("2026-11-08T17:00:00.000Z")]);
  });

  it("accepts a job that only removes dates", () => {
    expect(timeChangeJobPayloadSchema.safeParse({ ...payload, baseline: [] }).success).toBe(true);
  });

  it("refuses a job with nothing to tell or with an unknown time zone", () => {
    expect(
      timeChangeJobPayloadSchema.safeParse({ ...payload, baseline: [], removals: [] }).success,
    ).toBe(false);
    expect(
      timeChangeJobPayloadSchema.safeParse({ ...payload, previousZone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});
