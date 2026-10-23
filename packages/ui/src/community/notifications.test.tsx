import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NOW } from "./fixtures.test-utils";
import { formatUnreadCount, NotificationBell, NotificationList } from "./notifications";

const items = [
  {
    id: "n1",
    text: "Ana replied to your post",
    preview: "Try a slower wheel speed",
    createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
    read: false,
    href: "/c/makers/posts/1",
    actor: { name: "Ana Lima" },
  },
  {
    id: "n2",
    text: "Ben liked your comment",
    createdAt: NOW,
    read: true,
    href: "/c/makers/posts/2",
  },
];

describe("NotificationList", () => {
  it("renders items with time and an unread marker", () => {
    const onSelect = vi.fn();
    render(<NotificationList notifications={items} onSelect={onSelect} now={NOW} />);

    expect(screen.getByText("2 hours ago")).toBeTruthy();
    expect(screen.getByText("Try a slower wheel speed")).toBeTruthy();
    expect(screen.getAllByText("Unread")).toHaveLength(1);
    const link = screen.getByRole("link", { name: /Ana replied/ });
    expect(link.getAttribute("href")).toBe("/c/makers/posts/1");
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("shows the agent icon instead of initials when an agent asks for approval", () => {
    render(
      <NotificationList
        notifications={[
          {
            id: "n3",
            text: "Course helper wants to publish a post",
            createdAt: NOW,
            read: false,
            href: "/c/makers/manage/approvals",
            actor: { name: "Ana Lima", agent: true },
          },
        ]}
        onSelect={vi.fn()}
        now={NOW}
      />,
    );

    const link = screen.getByRole("link", { name: /Course helper wants to publish/ });
    expect(link.querySelector("[data-slot='agent-avatar']")).not.toBeNull();
    expect(link.textContent).not.toContain("AL");
  });

  it("keeps the page from scrolling when the list reaches its end", () => {
    render(<NotificationList notifications={items} onSelect={vi.fn()} now={NOW} />);

    expect(screen.getAllByRole("listitem")[0]?.parentElement?.className).toContain(
      "overscroll-contain",
    );
  });

  it("offers Mark all as read only when something is unread", () => {
    const onMarkAllRead = vi.fn();
    const { rerender } = render(
      <NotificationList notifications={items} onSelect={vi.fn()} onMarkAllRead={onMarkAllRead} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(onMarkAllRead).toHaveBeenCalledOnce();

    rerender(
      <NotificationList
        notifications={items.map((item) => ({ ...item, read: true }))}
        onSelect={vi.fn()}
        onMarkAllRead={onMarkAllRead}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });

  it("offers older notifications only when there are more to load", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <NotificationList notifications={items} onSelect={vi.fn()} onLoadMore={onLoadMore} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show older notifications" }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(
      <NotificationList
        notifications={items}
        onSelect={vi.fn()}
        onLoadMore={onLoadMore}
        loadingMore
      />,
    );
    expect(
      screen.getByRole("button", { name: "Loading older notifications…" }).hasAttribute("disabled"),
    ).toBe(true);

    rerender(<NotificationList notifications={items} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /older notifications/ })).toBeNull();
  });

  it("shows the empty state without an exclamation mark", () => {
    render(<NotificationList notifications={[]} onSelect={vi.fn()} />);

    const empty = screen.getByText("You're all caught up.");
    expect(empty.textContent).not.toContain("!");
  });
});

describe("NotificationBell", () => {
  it("caps the unread badge at 99+", () => {
    expect(formatUnreadCount(5)).toBe("5");
    expect(formatUnreadCount(99)).toBe("99");
    expect(formatUnreadCount(100)).toBe("99+");
  });

  it("labels the bell with the unread count and opens the list", () => {
    render(
      <NotificationBell unreadCount={120} notifications={items} onSelect={vi.fn()} now={NOW} />,
    );

    const bell = screen.getByRole("button", { name: "Notifications, 99+ unread" });
    expect(bell.textContent).toBe("99+");
    fireEvent.click(bell);
    expect(screen.getByText("Ana replied to your post")).toBeTruthy();
  });

  it("names the open popover dialog", () => {
    render(<NotificationBell unreadCount={1} notifications={items} onSelect={vi.fn()} now={NOW} />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    const dialog = screen.getByRole("dialog", { name: "Notifications" });
    expect(dialog.textContent).toContain("Ana replied to your post");
  });

  it("hides the badge without unread notifications", () => {
    render(<NotificationBell unreadCount={0} notifications={[]} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toBe("");
  });
});
