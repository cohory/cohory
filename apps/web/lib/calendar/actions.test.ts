import type * as CalendarModule from "@cohory/calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";

const occurrenceId = "0192f0c0-0000-7000-8000-0000000000a1";
const upcoming = [{ id: occurrenceId, canceledAt: null }];

const calendar = {
  createEvent: vi.fn(async () => ({ slug: "weekly-call" })),
  updateEvent: vi.fn(async () => ({ slug: "weekly-call" })),
  deleteEvent: vi.fn(async () => undefined),
  cancelOccurrence: vi.fn(async () => ({
    id: occurrenceId,
    canceledAt: new Date(),
    event: { slug: "weekly-call" },
  })),
  uncancelOccurrence: vi.fn(async () => ({
    id: occurrenceId,
    canceledAt: null,
    event: { slug: "weekly-call" },
  })),
  rsvp: vi.fn(async () => ({ status: "going", goingCount: 1 })),
  setRecordingUrl: vi.fn(async () => ({ recordingUrl: "https://video.example.com/1" })),
  getEvent: vi.fn(async () => ({ slug: "weekly-call", upcoming })),
};

vi.mock("@cohory/calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof CalendarModule>()),
  getCalendarService: () => calendar,
}));

vi.mock("../posts/context", () => ({
  resolveCommunity: vi.fn(async (slug: string) => ({
    communityId: "0192f0c0-0000-7000-8000-0000000000c1",
    slug,
    access: { actor: { kind: "user", userId: "u", platformAdmin: false }, role: "owner" },
  })),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const actions = await import("./actions");

const values = {
  title: "Weekly call",
  description: "",
  date: "2026-10-20",
  time: "18:00",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  recurrence: null,
  recurrenceUntil: "",
  location: "",
};

const layout = ["/c/demo", "layout"];
const list = ["/c/demo/calendar"];
const detail = [`/c/demo/calendar/weekly-call/${occurrenceId}`];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calendar actions revalidate what members see", () => {
  it("revalidates the occurrence detail and the calendar list after an edit", async () => {
    const result = await actions.updateEventAction({
      slug: "demo",
      eventSlug: "weekly-call",
      occurrenceId,
      values,
    });

    expect(result.ok).toBe(true);
    expect(revalidatePath.mock.calls).toEqual([layout, list, detail]);
  });

  it("revalidates the canceled occurrence and the list", async () => {
    await actions.setOccurrenceCanceledAction({ slug: "demo", occurrenceId, canceled: true });
    await actions.setOccurrenceCanceledAction({ slug: "demo", occurrenceId, canceled: false });

    expect(revalidatePath.mock.calls).toEqual([layout, list, detail, layout, list, detail]);
  });

  it("revalidates the whole community calendar after a recording link is saved", async () => {
    await actions.setRecordingAction({
      slug: "demo",
      eventSlug: "weekly-call",
      recordingUrl: "https://video.example.com/1",
    });

    expect(revalidatePath.mock.calls).toEqual([layout, list]);
  });

  it("revalidates after create, delete, and RSVP", async () => {
    await actions.createEventAction({ slug: "demo", values });
    await actions.deleteEventAction({ slug: "demo", eventSlug: "weekly-call" });
    await actions.rsvpAction({ slug: "demo", occurrenceId, status: "going" });

    expect(revalidatePath.mock.calls).toEqual([layout, list, layout, list, layout, list]);
  });

  it("does not revalidate when the save fails", async () => {
    calendar.setRecordingUrl.mockRejectedValueOnce(new Error("db down"));

    await expect(
      actions.setRecordingAction({ slug: "demo", eventSlug: "weekly-call", recordingUrl: "" }),
    ).rejects.toThrow("db down");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
