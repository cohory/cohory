import { describe, expect, it } from "vitest";

import { eventCanceledEmail } from "./event-canceled";

const base = {
  name: "Ada",
  communityName: "Dev",
  title: "Weekly call",
  when: "Tuesday, November 3, 2026 at 6:00 PM (Europe/Berlin)",
  calendarUrl: "http://localhost:3000/c/dev/calendar",
};

describe("eventCanceledEmail", () => {
  it("says a canceled date is off and that the calendar entry goes with it", () => {
    const email = eventCanceledEmail({ ...base, reason: "canceled" });

    expect(email.subject).toBe("[Dev] Canceled: Weekly call");
    expect(email.text).toContain("Hi Ada,");
    expect(email.text).toContain(`Weekly call on ${base.when} is canceled.`);
    expect(email.text).toContain("this email removes it");
    expect(email.html).toContain(`href="${base.calendarUrl}"`);
  });

  it("says a deleted event no longer takes place", () => {
    const email = eventCanceledEmail({ ...base, reason: "deleted" });

    expect(email.subject).toBe("[Dev] Canceled: Weekly call");
    expect(email.text).toContain(`Weekly call on ${base.when} no longer takes place.`);
  });

  it("confirms a member is not going", () => {
    const email = eventCanceledEmail({ ...base, reason: "not_going" });

    expect(email.subject).toBe("[Dev] Not going: Weekly call");
    expect(email.text).toContain(`You're not going to Weekly call on ${base.when}.`);
  });

  it("escapes markup in the title and uses no exclamation marks", () => {
    const email = eventCanceledEmail({
      ...base,
      title: "<img src=x onerror=alert(1)>",
      reason: "canceled",
    });

    expect(email.html).not.toContain("<img");
    expect(email.text).not.toContain("!");
  });
});
