import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventList } from "./event-list";
import { occurrence } from "./fixtures.test-utils";

describe("EventList", () => {
  it("groups events under day headings and wires RSVP per occurrence", () => {
    const onRsvp = vi.fn();
    const second = occurrence({ id: "o2", title: "Office hours" });
    render(
      <EventList
        groups={[
          { dateLabel: "Tuesday 3 November", occurrences: [occurrence()] },
          { dateLabel: "Empty day", occurrences: [] },
          { dateLabel: "Wednesday 4 November", occurrences: [second] },
        ]}
        timeZone="Europe/Berlin"
        eventHref={(item) => `/c/demo/calendar/${item.eventSlug}`}
        onRsvp={onRsvp}
        rsvpPendingId="o2"
      />,
    );

    expect(screen.getByRole("heading", { name: "Tuesday 3 November" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Empty day" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Going" })[0] as HTMLElement);
    expect(onRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: "occ-1" }), "going");
    expect(
      (screen.getAllByRole("button", { name: "Going" })[1] as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows an empty state for members", () => {
    render(<EventList groups={[]} timeZone="UTC" eventHref={() => "/"} />);

    expect(screen.getByText("No upcoming events")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers creators a primary Create an event action", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <EventList groups={[]} timeZone="UTC" eventHref={() => "/"} createAction={{ onSelect }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create an event" }));
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(
      <EventList
        groups={[]}
        timeZone="UTC"
        eventHref={() => "/"}
        createAction={{ href: "/c/demo/calendar/new" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Create an event" }).getAttribute("href")).toBe(
      "/c/demo/calendar/new",
    );
  });
});
