import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";

import { eventUpdatedEmail } from "./event-updated";

const base = {
  name: "Ada",
  communityName: "Dev",
  eventTitle: "Weekly call",
  oldStart: "Sunday, October 25, 2026 at 6:00 PM (Europe/Berlin)",
  newStart: "Sunday, October 25, 2026 at 7:00 PM (Europe/Berlin)",
  series: false,
  eventUrl: "http://localhost:3000/c/dev/calendar/weekly-call/occ-1",
  icsUrl: "http://localhost:3000/api/v1/communities/dev/calendar/occurrences/occ-1/ics",
};

describe("eventUpdatedEmail", () => {
  const email = eventUpdatedEmail(base);

  it("names the event and says the time changed in the subject", () => {
    expect(email.subject).toBe("[Dev] New time: Weekly call");
  });

  it("shows the old and the new time and keeps the RSVP", () => {
    expect(email.text).toContain("Hi Ada,");
    expect(email.text).toContain(`Was: ${base.oldStart}`);
    expect(email.text).toContain(`Now: ${base.newStart}`);
    expect(email.text).toContain("You are still going.");
  });

  it("links the event and an updated calendar file", () => {
    expect(email.html).toContain(`href="${base.eventUrl}"`);
    expect(email.text).toContain(base.icsUrl);
    expect(email.html).toContain(base.icsUrl);
  });

  it("says every upcoming date moves when the event repeats", () => {
    const series = eventUpdatedEmail({ ...base, series: true });

    expect(series.text).toContain("every upcoming date in the series");
    expect(email.text).not.toContain("series");
  });

  it("escapes markup in the title", () => {
    const hostile = eventUpdatedEmail({ ...base, eventTitle: "<img src=x onerror=alert(1)>" });

    expect(hostile.html).not.toContain("<img");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});
