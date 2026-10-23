import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { EventForm, type EventFormErrors, type EventFormValue } from "./event-form";
import { SeriesScopeDialog } from "./series-scope-dialog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const ZONES = ["America/New_York", "Europe/Berlin", "Europe/London", "UTC"];

const initial: EventFormValue = {
  title: "",
  description: "",
  date: "2026-11-03",
  time: "18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: null,
  recurrenceUntil: "",
  location: "",
  coverKey: null,
  coverUrl: null,
};

function Harness({
  errors,
  onSubmit = vi.fn(),
  pending,
  onValue,
  start = initial,
  viewerTimeZone,
  baseline,
}: {
  errors?: EventFormErrors;
  onSubmit?(): void;
  pending?: boolean;
  onValue?(value: EventFormValue): void;
  start?: EventFormValue;
  viewerTimeZone?: string;
  baseline?: Pick<EventFormValue, "date" | "time" | "timeZone">;
}) {
  const [value, setValue] = useState(start);
  return (
    <EventForm
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      onSubmit={onSubmit}
      errors={errors}
      pending={pending}
      timeZones={ZONES}
      viewerTimeZone={viewerTimeZone}
      baseline={baseline}
      submitLabel="Create event"
    />
  );
}

describe("EventForm", () => {
  it("shows errors next to their fields", () => {
    render(
      <Harness
        errors={{ title: "Add a title.", date: "Pick a date.", form: "Couldn't save the event." }}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByText("Add a title.")).toBeTruthy();
    expect(screen.getByLabelText("Date").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save the event.");
  });

  it("reveals the end date when weekly recurrence is turned on", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByLabelText("Ends on")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Repeats weekly" }));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ recurrence: "weekly" }));
    const until = screen.getByLabelText("Ends on");
    expect(until.getAttribute("min")).toBe("2026-11-03");
    fireEvent.change(until, { target: { value: "2026-12-15" } });
    fireEvent.click(screen.getByRole("switch", { name: "Repeats weekly" }));
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ recurrence: null, recurrenceUntil: "" }),
    );
    expect(screen.queryByLabelText("Ends on")).toBeNull();
  });

  it("opens more options when a hidden field has an error", () => {
    render(<Harness errors={{ description: "Keep it under 5000 characters." }} />);

    expect(screen.getByText("Keep it under 5000 characters.")).toBeTruthy();
  });

  it("searches time zones by city and selects the first match with Enter", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    const zone = screen.getByRole("combobox", { name: "Time zone" });
    expect((zone as HTMLInputElement).value).toMatch(/^Berlin \(UTC\+1\)/);
    fireEvent.focus(zone);
    fireEvent.change(zone, { target: { value: "new york" } });
    expect(
      within(screen.getByRole("listbox", { name: "Time zones" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["New York (UTC−5)"]);
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZone: "America/New_York" }),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says when the event happens for the viewer under the time fields", () => {
    render(
      <Harness
        start={{ ...initial, timeZone: "America/New_York", recurrence: "weekly", time: "19:00" }}
        viewerTimeZone="Europe/Berlin"
      />,
    );

    expect(screen.getByText("Every Tuesday, 19:00 EST (Wednesday 01:00 for you)")).toBeTruthy();
  });

  it("asks whether to keep the wall clock or the moment when the zone changes", () => {
    const onValue = vi.fn();
    render(
      <Harness
        onValue={onValue}
        baseline={{ date: initial.date, time: initial.time, timeZone: "Europe/Berlin" }}
      />,
    );

    const zone = screen.getByRole("combobox", { name: "Time zone" });
    fireEvent.focus(zone);
    fireEvent.change(zone, { target: { value: "london" } });
    fireEvent.keyDown(zone, { key: "Enter" });

    const choice = screen.getByRole("group", { name: /The time zone changed/ });
    const [keepClock, keepMoment] = within(choice).getAllByRole("radio");
    expect(keepClock).toHaveProperty("checked", true);
    expect(keepMoment).toHaveProperty("checked", false);
    if (keepMoment) fireEvent.click(keepMoment);
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZone: "Europe/London", date: "2026-11-03", time: "17:00" }),
    );
  });

  it("offers preset durations and a custom value", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    const duration = screen.getByRole("combobox", { name: "Duration" });
    expect(Array.from(duration.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "15 minutes",
      "30 minutes",
      "45 minutes",
      "1 hour",
      "1 hour 30 minutes",
      "2 hours",
      "Custom",
    ]);
    fireEvent.change(duration, { target: { value: "90" } });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ durationMinutes: 90 }));
    fireEvent.change(duration, { target: { value: "custom" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Duration in minutes" }), {
      target: { value: "75" },
    });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ durationMinutes: 75 }));
  });

  it("submits once and shows the pending state on its button", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(onSubmit).toHaveBeenCalledOnce();

    rerender(<Harness onSubmit={onSubmit} pending />);
    const button = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
});

describe("SeriesScopeDialog", () => {
  it("asks whether to cancel one occurrence or delete the series", () => {
    const onThisOnly = vi.fn();
    const onSeries = vi.fn();
    render(
      <SeriesScopeDialog
        open
        onOpenChange={vi.fn()}
        onThisOnly={onThisOnly}
        onSeries={onSeries}
        dateLabel="3 Nov"
        deletePreview={{ rsvps: 12, dates: 6 }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Cancel 3 Nov or delete the series?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep event" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this date" }));
    expect(onThisOnly).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete series" }));
    expect(onSeries).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete the whole series?" })).toBeTruthy();
    expect(
      screen.getByText("12 RSVPs on 6 upcoming dates will be removed. This can't be undone."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete series" }));
    expect(onSeries).toHaveBeenCalledOnce();
  });
});
