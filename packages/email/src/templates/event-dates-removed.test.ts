import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";

import { eventDatesRemovedEmail } from "./event-dates-removed";

const base = {
  name: "Ada",
  communityName: "Dev",
  eventTitle: "Weekly call",
  dates: ["Sunday, November 1, 2026 at 6:00 PM (Europe/Berlin)"],
  calendarUrl: "http://localhost:3000/c/dev/calendar",
};

describe("eventDatesRemovedEmail", () => {
  const email = eventDatesRemovedEmail(base);

  it("says the date is removed and the RSVP with it", () => {
    expect(email.subject).toBe("[Dev] Date removed: Weekly call");
    expect(email.text).toContain("Hi Ada,");
    expect(email.text).toContain(`Removed: ${base.dates[0]}`);
    expect(email.text).toContain("Your RSVP for it is removed too.");
    expect(email.html).toContain(`href="${base.calendarUrl}"`);
  });

  it("lists every removed date in the plural", () => {
    const many = eventDatesRemovedEmail({
      ...base,
      dates: [...base.dates, "Sunday, November 8, 2026 at 6:00 PM (Europe/Berlin)"],
    });

    expect(many.subject).toBe("[Dev] Dates removed: Weekly call");
    expect(many.text).toContain("Your RSVPs for them are removed too.");
    expect(many.text).toContain("Removed: Sunday, November 8, 2026");
  });

  it("escapes markup in the title and uses no exclamation marks", () => {
    const hostile = eventDatesRemovedEmail({ ...base, eventTitle: "<img src=x onerror=alert(1)>" });

    expect(hostile.html).not.toContain("<img");
    expect(allCopy(email)).not.toContain("!");
  });
});
