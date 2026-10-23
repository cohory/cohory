import { describe, expect, it } from "vitest";

import { reminderMessage, rsvpConfirmationMessage } from "./event-emails";
import { formatLocalTime, isInReminderWindow, reminderWindow } from "./reminders";

const now = new Date("2026-10-25T16:00:00Z");

describe("reminder window", () => {
  it("spans 55 to 65 minutes after now", () => {
    expect(reminderWindow(now)).toEqual({
      from: new Date("2026-10-25T16:55:00Z"),
      to: new Date("2026-10-25T17:05:00Z"),
    });
  });

  it.each([
    ["2026-10-25T16:54:59Z", false],
    ["2026-10-25T16:55:00Z", true],
    ["2026-10-25T17:00:00Z", true],
    ["2026-10-25T17:04:59Z", true],
    ["2026-10-25T17:05:00Z", false],
    ["2026-10-25T15:00:00Z", false],
  ])("treats a start at %s as due: %s", (iso, expected) => {
    expect(isInReminderWindow(new Date(iso), now)).toBe(expected);
  });

  it("selects every occurrence exactly once across runs every five minutes", () => {
    const start = new Date("2026-10-25T17:02:00Z");
    const runs = Array.from({ length: 24 }, (_, i) => new Date(now.getTime() + (i - 12) * 300_000));

    expect(runs.filter((run) => isInReminderWindow(start, run))).toHaveLength(2);
  });
});

const target = {
  occurrenceId: "o1",
  eventSlug: "weekly-call",
  email: "ada@example.test",
  name: "Ada",
  title: "Weekly call",
  timeZone: "Europe/Berlin",
  startsAt: new Date("2026-10-25T17:00:00Z"),
  location: "https://meet.example.com/abc",
};
const community = { slug: "dev", name: "Dev Club", brand: { logoUrl: null, accent: "#7C3AED" } };
const mail = {
  email: true,
  timeZone: "Europe/Istanbul",
  unsubscribeUrl: "http://localhost:3000/unsubscribe?token=t",
  headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
};

describe("reminder message", () => {
  it("shows the start in the member's zone first and the event zone second", () => {
    const message = reminderMessage(target, community, mail, "http://localhost:3000");

    expect(message.to).toBe("ada@example.test");
    expect(message.subject).toBe("[Dev Club] Starts in 1 hour: Weekly call");
    expect(message.fromName).toBe("Dev Club via Cohory");
    expect(message.html).toContain("background-color:#7C3AED");
    expect(message.text).toContain("When: Sunday, October 25, 2026 at 8:00 PM (Europe/Istanbul)");
    expect(message.text).toContain(
      "Event time: Sunday, October 25, 2026 at 6:00 PM (Europe/Berlin)",
    );
    expect(message.text).toContain("https://meet.example.com/abc");
    expect(message.text).toContain("http://localhost:3000/c/dev/calendar/weekly-call/o1");
  });

  it("carries the one click unsubscribe headers and footer", () => {
    const message = reminderMessage(target, community, mail, "http://localhost:3000");

    expect(message.headers).toEqual(mail.headers);
    expect(message.text).toContain("http://localhost:3000/unsubscribe?token=t");
  });

  it("attaches the invite to an RSVP confirmation only when there is one", () => {
    const withInvite = rsvpConfirmationMessage(target, community, mail, "http://localhost:3000", {
      method: "REQUEST",
      content: "BEGIN:VCALENDAR",
    });
    const without = rsvpConfirmationMessage(
      target,
      community,
      mail,
      "http://localhost:3000",
      undefined,
    );

    expect(withInvite.subject).toBe("[Dev Club] You're going: Weekly call");
    expect(withInvite.calendarInvite).toEqual({ method: "REQUEST", content: "BEGIN:VCALENDAR" });
    expect(without).not.toHaveProperty("calendarInvite");
    expect(without.text).toContain(
      "http://localhost:3000/api/v1/communities/dev/calendar/occurrences/o1/ics",
    );
  });

  it("formats local times in the given zone", () => {
    expect(formatLocalTime(new Date("2026-10-18T16:00:00Z"), "America/New_York")).toBe(
      "Sunday, October 18, 2026 at 12:00 PM (America/New_York)",
    );
  });
});
