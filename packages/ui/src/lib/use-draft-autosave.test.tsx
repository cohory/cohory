import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllDrafts,
  draftKey,
  useDraftAutosave,
  type DraftAutosave,
} from "./use-draft-autosave";

const key = "cohory:draft:test";

function parseText(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

const latest: { current: DraftAutosave<string> | null } = { current: null };

function Draft({
  value,
  dirty = true,
  storageKey = key,
}: {
  value: string;
  dirty?: boolean;
  storageKey?: string | null;
}) {
  const result = useDraftAutosave(storageKey, value, { dirty, parse: parseText, intervalMs: 1000 });
  useEffect(() => {
    latest.current = result;
  });
  return <p>{result.restore ? `restore ${result.restore.value}` : "nothing to restore"}</p>;
}

function draft(): DraftAutosave<string> {
  if (!latest.current) throw new Error("Draft is not rendered");
  return latest.current;
}

function stored(): unknown {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-22T10:42:00Z"));
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  latest.current = null;
});

describe("useDraftAutosave", () => {
  it("saves the typed value locally after the interval", () => {
    const { rerender } = render(<Draft value="" dirty={false} />);
    rerender(<Draft value="First paragraph" />);

    expect(stored()).toBeNull();
    act(() => vi.advanceTimersByTime(1000));

    expect(stored()).toEqual({ savedAt: "2026-10-22T10:42:01.000Z", value: "First paragraph" });
    expect(draft().savedAt?.toISOString()).toBe("2026-10-22T10:42:01.000Z");
  });

  it("offers a saved draft on return without overwriting it", () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: "2026-10-22T09:00:00.000Z", value: "Earlier text" }),
    );

    render(<Draft value="" dirty={false} />);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByText("restore Earlier text")).toBeTruthy();
    expect(draft().restore?.savedAt.toISOString()).toBe("2026-10-22T09:00:00.000Z");
    expect(stored()).toEqual({ savedAt: "2026-10-22T09:00:00.000Z", value: "Earlier text" });
  });

  it("ignores a stored draft that does not match the expected shape", () => {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: "yesterday", value: 42 }));

    render(<Draft value="" dirty={false} />);

    expect(screen.getByText("nothing to restore")).toBeTruthy();
  });

  it("removes the draft and the offer when cleared after a save", () => {
    const { rerender } = render(<Draft value="" dirty={false} />);
    rerender(<Draft value="Unsaved" />);
    act(() => draft().clear());
    act(() => vi.advanceTimersByTime(1000));

    expect(stored()).toBeNull();
    expect(draft().restore).toBeNull();
  });

  it("removes the draft when the value is back to the saved state", () => {
    const { rerender } = render(<Draft value="" dirty={false} />);
    rerender(<Draft value="Unsaved" />);
    act(() => vi.advanceTimersByTime(1000));
    rerender(<Draft value="" dirty={false} />);
    act(() => vi.advanceTimersByTime(1000));

    expect(stored()).toBeNull();
  });

  it("writes the pending value right away when the editor closes", () => {
    const { rerender, unmount } = render(<Draft value="" dirty={false} />);
    rerender(<Draft value="Typed just before leaving" />);
    unmount();

    expect(stored()).toEqual({
      savedAt: "2026-10-22T10:42:00.000Z",
      value: "Typed just before leaving",
    });
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { rerender } = render(<Draft value="" dirty={false} />);
    rerender(<Draft value="Still typing" />);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByText("nothing to restore")).toBeTruthy();
    expect(draft().savedAt).toBeNull();
  });

  it("does nothing without a key", () => {
    const { rerender } = render(<Draft value="" dirty={false} storageKey={null} />);
    rerender(<Draft value="Typed" storageKey={null} />);
    act(() => vi.advanceTimersByTime(1000));

    expect(window.localStorage.length).toBe(0);
  });
});

describe("clearAllDrafts", () => {
  it("removes every saved draft and leaves other storage alone", () => {
    window.localStorage.setItem(draftKey("lesson", "l1"), "{}");
    window.localStorage.setItem(draftKey("post", "design"), "{}");
    window.localStorage.setItem("cohory:theme", "dark");

    clearAllDrafts();

    expect(window.localStorage.getItem(draftKey("lesson", "l1"))).toBeNull();
    expect(window.localStorage.getItem(draftKey("post", "design"))).toBeNull();
    expect(window.localStorage.getItem("cohory:theme")).toBe("dark");
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => clearAllDrafts()).not.toThrow();
  });
});
