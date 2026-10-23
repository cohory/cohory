import { describe, expect, it } from "vitest";

import { nextEventLine } from "./next-event";

describe("nextEventLine", () => {
  it("names the next event with its day and time in UTC", () => {
    expect(
      nextEventLine({
        kind: "event",
        title: "Live call",
        startsAt: new Date("2026-10-27T18:00:00Z"),
      }),
    ).toBe("Next event: Live call, Tue 27 Oct, 18:00 UTC");
  });

  it("gives only the day when the community keeps its events private", () => {
    expect(nextEventLine({ kind: "date", date: "2026-10-27" })).toBe("Next event: Tue 27 Oct");
  });

  it("says nothing without an upcoming event", () => {
    expect(nextEventLine(null)).toBeNull();
  });
});
