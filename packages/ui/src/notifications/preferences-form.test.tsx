import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatHour, NotificationPreferencesForm } from "./preferences-form";

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

const rows = [
  { type: "mention", label: "Mentions", inApp: true, email: "immediate" as const },
  {
    type: "comment_on_post",
    label: "Comments on your posts",
    inApp: false,
    email: "daily" as const,
  },
];

function renderForm(action = vi.fn()) {
  render(
    <NotificationPreferencesForm
      rows={rows}
      digestHour={8}
      timeZone="Europe/Berlin"
      timeZones={["UTC", "America/New_York"]}
      weeklyDigest
      action={action}
    />,
  );
  return action;
}

describe("NotificationPreferencesForm", () => {
  it("shows one row per type with labelled controls", () => {
    renderForm();

    expect(screen.getByRole("rowheader", { name: "Mentions" })).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Mentions in the app" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Comments on your posts in the app" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      (
        screen.getByRole("combobox", {
          name: "Comments on your posts by email",
        }) as HTMLSelectElement
      ).value,
    ).toBe("daily");
  });

  it("keeps the saved time zone selectable when it is not in the list", () => {
    renderForm();

    expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLSelectElement).value).toBe(
      "Europe/Berlin",
    );
  });

  it("submits the toggled values as form fields", () => {
    const { container } = render(
      <NotificationPreferencesForm
        rows={rows}
        digestHour={8}
        timeZone="UTC"
        timeZones={["UTC"]}
        weeklyDigest
        action={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Mentions in the app" }));
    fireEvent.click(screen.getByRole("switch", { name: "Weekly digest email" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Mentions by email" }), {
      target: { value: "off" },
    });

    const form = container.querySelector("form");
    if (!form) throw new Error("form missing");
    const data = new FormData(form);
    expect(data.get("inApp:mention")).toBe("off");
    expect(data.get("email:mention")).toBe("off");
    expect(data.get("inApp:comment_on_post")).toBe("off");
    expect(data.get("digestHour")).toBe("8");
    expect(data.get("weeklyDigest")).toBe("off");
  });

  it("formats hours as a 24 hour clock", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(18)).toBe("18:00");
  });
});
