import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CalendarMonth } from "./calendar-month";
import { CalendarViewSwitch } from "./calendar-view-switch";
import { occurrence } from "./fixtures.test-utils";
import type { EventOccurrence } from "./types";

const NOW = new Date("2026-10-18T10:00:00Z");
const BERLIN = "Europe/Berlin";

function Harness({
  occurrences = [],
  onSelectDay,
  initialMonth = "2026-10",
}: {
  occurrences?: EventOccurrence[];
  onSelectDay?(date: string): void;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  return (
    <CalendarMonth
      month={month}
      occurrences={occurrences}
      timeZone={BERLIN}
      onMonthChange={setMonth}
      onSelectDay={onSelectDay}
      now={NOW}
    />
  );
}

function day(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("CalendarMonth", () => {
  it("renders an accessible grid with labelled days and today marked", () => {
    render(<Harness />);

    const grid = screen.getByRole("grid", { name: "October 2026" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);
    const today = day(/^Sunday,? 18 October 2026, today, No events$/);
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.getAttribute("tabindex")).toBe("0");
    expect(day(/^Monday,? 19 October 2026, No events$/).getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus with arrow keys, Home, and End inside the month", () => {
    render(<Harness />);

    fireEvent.keyDown(day(/18 October 2026/), { key: "ArrowRight" });
    expect(document.activeElement).toBe(day(/19 October 2026/));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(day(/26 October 2026/));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day(/18 October 2026/));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(day(/12 October 2026/));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(day(/^Sunday,? 18 October/));
  });

  it("changes month when focus crosses the edges and on PageUp", () => {
    render(<Harness />);

    fireEvent.keyDown(day(/18 October 2026/), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(day(/^Sunday,? 1 November 2026/));
    fireEvent.keyDown(document.activeElement as Element, { key: "PageUp" });
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(day(/^Thursday,? 1 October 2026/));
  });

  it("caps markers at three and shows the overflow count", () => {
    const occurrences = [16, 17, 18, 19, 20].map((hour) =>
      occurrence({
        id: `o${hour}`,
        title: `Event ${hour}`,
        startsAt: `2026-10-21T${hour}:00:00Z`,
        endsAt: `2026-10-21T${hour}:30:00Z`,
      }),
    );
    render(<Harness occurrences={occurrences} />);

    const cell = day(/21 October 2026, 5 events/);
    expect(cell.querySelectorAll("li")).toHaveLength(3);
    expect(cell.querySelector("[data-slot='calendar-overflow']")?.textContent).toBe("+2");
    expect(within(cell).queryByText("Event 19")).toBeNull();
  });

  it("names each day button with the titles of its events", () => {
    render(
      <Harness
        occurrences={[
          occurrence({
            id: "a",
            title: "Morning run",
            startsAt: "2026-10-22T07:00:00Z",
            endsAt: "2026-10-22T08:00:00Z",
          }),
          occurrence({
            id: "b",
            title: "Book club",
            canceled: true,
            startsAt: "2026-10-22T17:00:00Z",
            endsAt: "2026-10-22T18:00:00Z",
          }),
        ]}
      />,
    );

    const cell = day(/^Thursday,? 22 October 2026, 2 events: Morning run, Book club \(canceled\)$/);
    expect(cell.hasAttribute("aria-label")).toBe(false);
    expect(within(cell).getByText("Morning run").closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("places events on the day in the calendar's zone", () => {
    render(
      <Harness
        occurrences={[
          occurrence({ startsAt: "2026-10-24T22:30:00Z", endsAt: "2026-10-24T23:30:00Z" }),
        ]}
      />,
    );

    expect(day(/25 October 2026, 1 event/)).toBeTruthy();
    expect(day(/24 October 2026, No events/)).toBeTruthy();
  });

  it("selects days, pages months, and returns to today", () => {
    const onSelectDay = vi.fn();
    render(<Harness onSelectDay={onSelectDay} initialMonth="2026-12" />);

    fireEvent.click(day(/^Thursday,? 3 December 2026/));
    expect(onSelectDay).toHaveBeenCalledWith("2026-12-03");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("grid", { name: "January 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeTruthy();
  });

  it("lets the caller render day contents", () => {
    render(
      <CalendarMonth
        month="2026-10"
        occurrences={[
          occurrence({ startsAt: "2026-10-05T10:00:00Z", endsAt: "2026-10-05T11:00:00Z" }),
        ]}
        timeZone={BERLIN}
        onMonthChange={vi.fn()}
        now={NOW}
        renderDay={(cell, items) => (items.length ? <span>{`custom ${cell.date}`}</span> : null)}
      />,
    );

    expect(screen.getByText("custom 2026-10-05")).toBeTruthy();
  });
});

describe("CalendarViewSwitch", () => {
  it("switches between month and list with pressed buttons that control no panel", () => {
    const onChange = vi.fn();
    render(<CalendarViewSwitch view="list" onChange={onChange} />);

    const group = screen.getByRole("group", { name: "Calendar view" });
    const list = screen.getByRole("button", { name: "List" });
    expect(group).toBeTruthy();
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(list.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(list);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
