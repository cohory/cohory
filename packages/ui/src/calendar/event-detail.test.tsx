import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventDetail, type EventDetailEvent } from "./event-detail";
import { occurrence } from "./fixtures.test-utils";

const event: EventDetailEvent = {
  description: "Bring questions.\nWe record the call.",
  timeZone: "America/New_York",
  location: { kind: "link", url: "https://meet.example.com/abc" },
  recurrenceUntil: "2026-12-15",
};

const BEFORE = new Date("2026-11-03T12:00:00Z");
const SOON = new Date("2026-11-03T16:50:00Z");

describe("EventDetail", () => {
  it("shows viewer and event time zones, duration, recurrence, and description", () => {
    const { container } = render(
      <EventDetail
        occurrence={occurrence({ recurrence: "weekly" })}
        event={event}
        viewerTimeZone="Europe/Berlin"
        icsHref="/e.ics"
        onRsvp={vi.fn()}
        now={BEFORE}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Weekly call" })).toBeTruthy();
    expect(screen.getByText(/Tuesday,? 3 November 2026, 18:00–19:00 CET/)).toBeTruthy();
    expect(screen.getByText(/Event time: Tuesday,? 3 November 2026, 12:00–13:00 EST/)).toBeTruthy();
    expect(screen.getByText("1 hour")).toBeTruthy();
    expect(screen.getByText("Every Tuesday until 15 December 2026")).toBeTruthy();
    expect(container.querySelector("p.whitespace-pre-line.break-words")?.textContent).toBe(
      "Bring questions.\nWe record the call.",
    );
    expect(screen.queryByRole("link", { name: "Join call" })).toBeNull();
    expect(screen.getByText("https://meet.example.com/abc")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add to calendar" }).getAttribute("href")).toBe(
      "/e.ics",
    );
    expect(screen.getByRole("button", { name: "Going" }).className).toContain("bg-accent");
  });

  it("hides the event zone line when it matches the viewer", () => {
    render(
      <EventDetail
        occurrence={occurrence()}
        event={{ ...event, timeZone: "Europe/Berlin" }}
        viewerTimeZone="Europe/Berlin"
        icsHref="/e.ics"
        now={BEFORE}
      />,
    );

    expect(screen.queryByText(/Event time:/)).toBeNull();
  });

  it("turns the link into a Join call button 15 minutes before the start", () => {
    const onRsvp = vi.fn();
    render(
      <EventDetail
        occurrence={occurrence()}
        event={event}
        viewerTimeZone="Europe/Berlin"
        icsHref="/e.ics"
        onRsvp={onRsvp}
        now={SOON}
      />,
    );

    const join = screen.getByRole("link", { name: "Join call" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/abc");
    expect(join.getAttribute("rel")).toBe("noopener noreferrer");
    const going = screen.getByRole("button", { name: "Going" });
    expect(going.className).not.toContain("bg-accent ");
    fireEvent.click(going);
    expect(onRsvp).toHaveBeenCalledWith("going");
  });

  it("never links unsafe join URLs", () => {
    render(
      <EventDetail
        occurrence={occurrence()}
        event={{ ...event, location: { kind: "link", url: "javascript:alert(1)" } }}
        viewerTimeZone="UTC"
        icsHref="/e.ics"
        now={SOON}
      />,
    );

    expect(screen.queryByRole("link", { name: "Join call" })).toBeNull();
  });

  it("shows a canceled banner and removes RSVP and calendar actions", () => {
    render(
      <EventDetail
        occurrence={occurrence({ canceled: true })}
        event={{ ...event, location: { kind: "text", text: "Main hall\nRoom 2" } }}
        viewerTimeZone="UTC"
        icsHref="/e.ics"
        onRsvp={vi.fn()}
        now={BEFORE}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("This event was canceled");
    expect(screen.queryByRole("button", { name: "Going" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add to calendar" })).toBeNull();
    expect(screen.getByText(/Main hall/)).toBeTruthy();
  });

  it("links the recording, shows who is going, and hides RSVP after the end", () => {
    render(
      <EventDetail
        occurrence={occurrence({
          going: [
            { userId: "u1", name: "Ada Lovelace", image: null },
            { userId: "u2", name: "Grace Hopper", image: null },
          ],
        })}
        event={{ ...event, location: null, recordingUrl: "https://video.example.com/r" }}
        viewerTimeZone="UTC"
        icsHref="/e.ics"
        onRsvp={vi.fn()}
        now={new Date("2026-11-04T00:00:00Z")}
      />,
    );

    expect(screen.getByRole("link", { name: "Watch recording" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Going: Ada Lovelace, Grace Hopper" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /RSVP/ })).toBeNull();
  });
});
