import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBellClient } from "./notification-bell";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "hidden");
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(Response.json(body));
}

describe("NotificationBellClient", () => {
  it("renders the bell with the server count before any request finishes", () => {
    render(<NotificationBellClient initialUnread={3} />);

    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeTruthy();
  });

  it("keeps the bell when the count request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    render(<NotificationBellClient initialUnread={0} />);
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("skips the background poll while the tab is hidden", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => jsonResponse({ unreadCount: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    setHidden(true);
    render(<NotificationBellClient initialUnread={1} />);

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).not.toHaveBeenCalled();

    setHidden(false);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();
  });

  it("shows the fresh server count after the page refreshes", () => {
    const { rerender } = render(<NotificationBellClient initialUnread={1} />);

    rerender(<NotificationBellClient initialUnread={5} />);

    expect(screen.getByRole("button", { name: "Notifications, 5 unread" })).toBeTruthy();
  });

  it("lists notifications from the API when the bell opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          data: [
            {
              id: "n1",
              type: "comment",
              text: "Ana replied to your post",
              preview: "Try a slower wheel speed",
              actor: { name: "Ana", image: null },
              href: "/c/makers/posts/1",
              community: { slug: "makers" },
              readAt: null,
              createdAt: "2026-10-21T10:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<NotificationBellClient initialUnread={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));

    const link = await screen.findByRole("link", {
      name: /Ana replied to your post.*Try a slower wheel speed/,
    });
    expect(link.getAttribute("href")).toBe("/c/makers/posts/1");
  });

  it("marks a notification read when it is opened and shows the agent icon for approvals", async () => {
    const fetchMock = vi.fn((url: string) =>
      url.endsWith("/read")
        ? Promise.resolve(new Response(null, { status: 204 }))
        : jsonResponse({
            data: [
              {
                id: "0192f2a4-0000-7000-8000-000000000001",
                type: "approval_request",
                text: "Course helper wants to publish a post",
                preview: null,
                actor: { name: "Ana Lima", image: null },
                href: "/c/makers/manage/approvals",
                community: { slug: "makers" },
                readAt: null,
                createdAt: "2026-10-21T10:00:00.000Z",
              },
            ],
            nextCursor: null,
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBellClient initialUnread={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    const link = await screen.findByRole("link", { name: /Course helper wants to publish/ });
    expect(link.querySelector("[data-slot='agent-avatar']")).not.toBeNull();
    fireEvent.click(link);

    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/notifications/read", expect.anything());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("loads older notifications with the cursor from the previous page", async () => {
    const item = (id: string, text: string) => ({
      id,
      type: "comment",
      text,
      actor: { name: "Ana", image: null },
      href: "/c/makers/posts/1",
      community: { slug: "makers" },
      readAt: "2026-10-21T11:00:00.000Z",
      createdAt: "2026-10-21T10:00:00.000Z",
    });
    const fetchMock = vi.fn((url: string) =>
      url.includes("cursor=")
        ? jsonResponse({ data: [item("n2", "Ben liked your post")], nextCursor: null })
        : jsonResponse({ data: [item("n1", "Ana replied to your post")], nextCursor: "c1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBellClient initialUnread={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show older notifications" }));

    expect(await screen.findByRole("link", { name: /Ben liked your post/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ana replied to your post/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/notifications?limit=20&cursor=c1",
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: "Show older notifications" })).toBeNull();
  });

  it("shows an empty list when the API sends a notification with an outside link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          data: [
            {
              id: "n1",
              type: "comment",
              text: "Ana replied to your post",
              actor: { name: "Ana", image: null },
              href: "https://example.com",
              community: { slug: "makers" },
              readAt: null,
              createdAt: "2026-10-21T10:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<NotificationBellClient initialUnread={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading notifications" })).toBeNull(),
    );
    expect(screen.queryByRole("link", { name: /Ana replied/ })).toBeNull();
  });
});
