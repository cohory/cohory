import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventCard, EventCardSkeleton } from "./event-card";
import { occurrence } from "./fixtures.test-utils";

const BERLIN = "Europe/Berlin";

describe("EventCard", () => {
  it("renders the date block, title link, time range with zone, and going count", () => {
    const { container } = render(
      <EventCard
        occurrence={occurrence({ recurrence: "weekly" })}
        timeZone={BERLIN}
        href="/c/demo/calendar/weekly-call?date=2026-11-03"
      />,
    );

    expect(screen.getByRole("link", { name: "Weekly call" }).getAttribute("href")).toBe(
      "/c/demo/calendar/weekly-call?date=2026-11-03",
    );
    const block = container.querySelector("[data-slot='event-date-block']");
    expect(block?.getAttribute("dateTime")).toBe("2026-11-03T17:00:00Z");
    expect(block?.textContent).toContain("Tuesday");
    expect(screen.getByText("18:00–19:00 CET")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("12 going")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /RSVP/ })).toBeNull();
  });

  it("shows faces of members going and links a past recording", () => {
    render(
      <EventCard
        occurrence={occurrence({
          going: [{ userId: "u1", name: "Ada Lovelace", image: null }],
          recordingUrl: "https://video.example.com/r",
        })}
        timeZone={BERLIN}
        href="/e"
      />,
    );

    expect(screen.getByRole("list", { name: "Going: Ada Lovelace" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Watch recording" }).getAttribute("href")).toBe(
      "https://video.example.com/r",
    );
  });

  it("renders times in the zone the caller passes", () => {
    render(<EventCard occurrence={occurrence()} timeZone="UTC" href="/e" />);

    expect(screen.getByText("17:00–18:00 UTC")).toBeTruthy();
  });

  it("makes Going the primary action when the viewer has not answered", () => {
    const onRsvp = vi.fn();
    render(<EventCard occurrence={occurrence()} timeZone={BERLIN} href="/e" onRsvp={onRsvp} />);

    const group = screen.getByRole("group", { name: "RSVP to Weekly call" });
    const going = within(group).getByRole("button", { name: "Going" });
    expect(going.getAttribute("aria-pressed")).toBe("false");
    expect(going.className).toContain("bg-accent");
    fireEvent.click(going);
    expect(onRsvp).toHaveBeenCalledWith("going");
    fireEvent.click(within(group).getByRole("button", { name: "Not going" }));
    expect(onRsvp).toHaveBeenLastCalledWith("not_going");
  });

  it("shows a pressed Going state with an option to change", () => {
    const onRsvp = vi.fn();
    render(
      <EventCard
        occurrence={occurrence({ viewerStatus: "going", goingCount: 13 })}
        timeZone={BERLIN}
        href="/e"
        onRsvp={onRsvp}
      />,
    );

    const going = screen.getByRole("button", { name: "Going" });
    expect(going.getAttribute("aria-pressed")).toBe("true");
    expect(going.className).not.toContain("bg-accent ");
    fireEvent.click(going);
    expect(onRsvp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Can't go" }));
    expect(onRsvp).toHaveBeenCalledWith("not_going");
  });

  it("disables RSVP buttons while a change is pending", () => {
    render(
      <EventCard
        occurrence={occurrence()}
        timeZone={BERLIN}
        href="/e"
        onRsvp={vi.fn()}
        rsvpPending
      />,
    );

    expect(screen.getByRole("group", { name: /RSVP/ }).getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Going" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("labels canceled occurrences and hides RSVP", () => {
    const { container } = render(
      <EventCard
        occurrence={occurrence({ canceled: true })}
        timeZone={BERLIN}
        href="/e"
        onRsvp={vi.fn()}
      />,
    );

    expect(screen.getByText("Canceled")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Weekly call" }).className).toContain(
      "line-through",
    );
    expect(container.querySelector("[data-canceled]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Going" })).toBeNull();
  });

  it("shows item actions in a labelled menu", () => {
    render(
      <EventCard
        occurrence={occurrence()}
        timeZone={BERLIN}
        href="/e"
        actions={[{ id: "edit", label: "Edit event", onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions for Weekly call" })).toBeTruthy();
  });

  it("renders a hidden skeleton in both variants", () => {
    const { container, rerender } = render(<EventCardSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    rerender(<EventCardSkeleton variant="compact" />);
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(4);
  });
});
