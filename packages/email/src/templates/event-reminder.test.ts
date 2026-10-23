import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";

import { eventReminderEmail } from "./event-reminder";
import { rsvpConfirmationEmail } from "./rsvp-confirmation";

const base = {
  name: "Ada",
  communityName: "Dev",
  title: "Weekly call",
  when: "Sunday, October 25, 2026 at 7:00 PM (Europe/Istanbul)",
  eventWhen: "Sunday, October 25, 2026 at 6:00 PM (Europe/Berlin)",
  location: "https://meet.example.com/abc?x=1&y=2",
  eventUrl: "http://localhost:3000/c/dev/calendar/weekly-call/o1",
  footer: {
    unsubscribeUrl: "http://localhost:3000/unsubscribe?token=t",
    preferencesUrl: "http://localhost:3000/account/notifications",
  },
};

describe("eventReminderEmail", () => {
  const email = eventReminderEmail(base);

  it("names the community and the event in the subject", () => {
    expect(email.subject).toBe("[Dev] Starts in 1 hour: Weekly call");
    expect(email.text).toContain("Hi Ada,");
  });

  it("shows the member's time first and the event time second", () => {
    expect(email.text).toContain(`When: ${base.when}`);
    expect(email.text).toContain(`Event time: ${base.eventWhen}`);
    expect(email.text.indexOf(base.when)).toBeLessThan(email.text.indexOf(base.eventWhen));
  });

  it("links both the call and the event page", () => {
    expect(email.html).toContain('href="https://meet.example.com/abc?x=1&amp;y=2"');
    expect(email.html).toContain("Join the call");
    expect(email.html).toContain(`href="${base.eventUrl}"`);
    expect(email.html).toContain("Event details");
  });

  it("says why it came and how to stop it", () => {
    expect(email.text).toContain("event reminder emails are on");
    expect(email.html).toContain(`href="${base.footer.unsubscribeUrl}"`);
    expect(email.text).toContain("Stop event reminder emails");
  });

  it("shows a text location and links the event page instead of a call", () => {
    const inPerson = eventReminderEmail({ ...base, location: "Room 4, Main Street 1" });

    expect(inPerson.text).toContain("Where: Room 4, Main Street 1");
    expect(inPerson.html).not.toContain("Join the call");
    expect(inPerson.html).toContain(`href="${base.eventUrl}"`);
  });

  it("leaves out the event time when it matches the member's", () => {
    const same = eventReminderEmail({ ...base, eventWhen: null });

    expect(same.text).not.toContain("Event time:");
  });

  it("escapes markup in the title", () => {
    const hostile = eventReminderEmail({ ...base, title: "<img src=x onerror=alert(1)>" });

    expect(hostile.html).not.toContain("<img");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("rsvpConfirmationEmail", () => {
  const email = rsvpConfirmationEmail({ ...base, icsUrl: "http://localhost:3000/ics/o1" });

  it("confirms the RSVP with the time in the member's zone", () => {
    expect(email.subject).toBe("[Dev] You're going: Weekly call");
    expect(email.text).toContain(`When: ${base.when}`);
    expect(email.text).toContain("Add to calendar");
  });

  it("offers the calendar file, the event page, and a way to stop", () => {
    expect(email.html).toContain('href="http://localhost:3000/ics/o1"');
    expect(email.html).toContain(`href="${base.eventUrl}"`);
    expect(email.html).toContain(`href="${base.footer.unsubscribeUrl}"`);
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});
