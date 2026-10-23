import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionList } from "./session-list";

const now = new Date("2026-10-18T10:00:00Z");

describe("SessionList", () => {
  const sessions = [
    { id: "s1", device: "Chrome on macOS", lastActiveAt: now, createdAt: now, current: true },
    {
      id: "s2",
      device: "Safari on iPhone",
      lastActiveAt: new Date(now.getTime() - 2 * 3_600_000),
      createdAt: now,
      current: false,
    },
  ];

  it("marks the current device and offers sign out for the others", () => {
    const onRevoke = vi.fn();
    const onRevokeOthers = vi.fn();
    render(
      <SessionList
        sessions={sessions}
        onRevoke={onRevoke}
        onRevokeOthers={onRevokeOthers}
        now={now}
      />,
    );

    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.getByText("Last active 2 hours ago")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out Safari on iPhone" }));
    expect(onRevoke).toHaveBeenCalledWith("s2");
    fireEvent.click(screen.getByRole("button", { name: "Sign out all other devices" }));
    expect(onRevokeOthers).toHaveBeenCalledOnce();
  });

  it("says so when there are no other sessions", () => {
    render(
      <SessionList sessions={sessions.slice(0, 1)} onRevoke={vi.fn()} onRevokeOthers={vi.fn()} />,
    );

    expect(screen.getByText("You are not signed in anywhere else.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });
});
