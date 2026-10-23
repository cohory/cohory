import type { EventFormValue } from "@cohory/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const updateEventAction = vi.fn();
const createEventAction = vi.fn();
const previewEventChangeAction = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../lib/calendar/actions", () => ({
  createEventAction,
  updateEventAction,
  previewEventChangeAction,
}));

const { EventFormPanel } = await import("./event-form-panel");

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const initial: EventFormValue = {
  title: "Weekly call",
  description: "",
  date: "2026-11-03",
  time: "18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: "weekly",
  recurrenceUntil: "",
  location: "",
  coverKey: null,
  coverUrl: null,
};

const edit = { kind: "edit", eventSlug: "weekly-call", occurrenceId: "occ-1" } as const;

function panel(moving: number, removing = 0) {
  previewEventChangeAction.mockResolvedValue({ ok: true, data: { moving, removing } });
  return render(
    <EventFormPanel
      slug="dev"
      mode={edit}
      initial={initial}
      timeZones={["Europe/Berlin", "America/New_York"]}
    />,
  );
}

describe("EventFormPanel", () => {
  it("says who will be emailed once the start time changes", async () => {
    panel(3);
    expect(screen.queryByText(/people are going/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "19:00" } });

    expect(
      await screen.findByText("3 people are going. We'll email them the new time."),
    ).toBeTruthy();
    expect(previewEventChangeAction).toHaveBeenLastCalledWith({
      slug: "dev",
      eventSlug: "weekly-call",
      values: { ...initial, time: "19:00" },
    });
  });

  it("warns about people going to dates that will be removed", async () => {
    panel(1, 2);

    const zone = screen.getByRole("combobox", { name: "Time zone" });
    fireEvent.focus(zone);
    fireEvent.change(zone, { target: { value: "new york" } });
    fireEvent.keyDown(zone, { key: "Enter" });

    expect(
      await screen.findByText(
        "1 person is going. We'll email them the new time. 2 people are going to dates that will be removed. We'll tell them.",
      ),
    ).toBeTruthy();
  });

  it("asks nothing and says nothing when only the title changes", async () => {
    panel(1);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(previewEventChangeAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/going/)).toBeNull();
  });

  it("says nothing when nobody is going", async () => {
    panel(0);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "19:00" } });

    await waitFor(() => expect(previewEventChangeAction).toHaveBeenCalled());
    expect(screen.queryByText(/going/)).toBeNull();
  });

  it("asks to tell members on create and sends the choice with the event", async () => {
    createEventAction.mockResolvedValueOnce({ ok: true, data: { href: "/c/dev/calendar/x/1" } });
    render(
      <EventFormPanel
        slug="dev"
        mode={{ kind: "create" }}
        initial={{ ...initial, recurrence: null }}
        timeZones={["Europe/Berlin"]}
      />,
    );

    const notify = screen.getByRole("switch", { name: "Tell members about this event" });
    expect(notify.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(notify);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kickoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/c/dev/calendar/x/1"));
    expect(createEventAction).toHaveBeenCalledWith({
      slug: "dev",
      values: { ...initial, recurrence: null, title: "Kickoff" },
      notifyMembers: false,
    });
  });

  it("offers to restore a draft kept on this device", async () => {
    window.localStorage.setItem(
      "cohory:draft:event:dev:weekly-call",
      JSON.stringify({
        savedAt: "2026-10-20T10:00:00.000Z",
        value: { ...initial, title: "Draft title" },
      }),
    );
    panel(0);

    fireEvent.click(await screen.findByRole("button", { name: "Restore changes" }));
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Draft title");
    expect(screen.queryByRole("button", { name: "Restore changes" })).toBeNull();
  });

  it("frees the form and keeps the values when saving fails", async () => {
    updateEventAction.mockRejectedValueOnce(new Error("offline"));
    panel(0);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(
        "We couldn't save your changes. Check your connection and try again.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Renamed");
    expect(push).not.toHaveBeenCalled();
  });
});
