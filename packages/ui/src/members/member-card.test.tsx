import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { member } from "./fixtures.test-utils";
import { MemberCard, MemberCardSkeleton } from "./member-card";

describe("MemberCard", () => {
  it("renders name, username, level, points, and joined date as a link", () => {
    render(<MemberCard member={member()} href="/c/demo/members/ana" locale="en-US" />);

    expect(screen.getByRole("link", { name: "Ana Lima" }).getAttribute("href")).toBe(
      "/c/demo/members/ana",
    );
    expect(screen.getByText("@ana")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Level 3, Regular" })).toBeTruthy();
    expect(screen.getByText("120 points")).toBeTruthy();
    expect(screen.getByText("Joined March 4, 2026")).toBeTruthy();
  });

  it("shows a role badge for creators, admins, and moderators only", () => {
    const { rerender } = render(<MemberCard member={member({ role: "owner" })} href="/m" />);
    expect(screen.getByText("Creator")).toBeTruthy();

    rerender(<MemberCard member={member({ role: "moderator" })} href="/m" />);
    expect(screen.getByText("Moderator")).toBeTruthy();

    rerender(<MemberCard member={member({ role: "member" })} href="/m" />);
    expect(screen.queryByText(/Creator|Admin|Moderator/)).toBeNull();
  });

  it("hides level and points when gamification is turned off", () => {
    render(<MemberCard member={member()} href="/m" gamificationEnabled={false} variant="grid" />);

    expect(screen.queryByRole("img", { name: /Level/ })).toBeNull();
    expect(screen.queryByText(/points/)).toBeNull();
  });

  it("renders a separately focusable actions menu", () => {
    render(
      <MemberCard
        member={member()}
        href="/m"
        actions={[{ id: "remove", label: "Remove member", onSelect: vi.fn(), variant: "danger" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions for Ana Lima" })).toBeTruthy();
  });

  it("shows extra details inside the card", () => {
    render(
      <MemberCard
        member={member()}
        href="/m"
        details={<span>ana@example.com</span>}
        locale="en-US"
      />,
    );

    const card = screen.getByRole("article");
    expect(card.textContent).toContain("ana@example.com");
  });

  it("keeps the server markup when the browser formats the joined date differently", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<MemberCard member={member()} href="/m" locale="en-US" />);
    document.body.append(container);
    const serverCard = container.querySelector("[data-slot=member-card]");
    const recoverableErrors: unknown[] = [];

    const root = await act(async () =>
      hydrateRoot(container, <MemberCard member={member()} href="/m" locale="en-GB" />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      }),
    );

    expect(recoverableErrors).toEqual([]);
    expect(container.querySelector("[data-slot=member-card]")).toBe(serverCard);
    act(() => root.unmount());
    container.remove();
  });

  it("has list and grid skeletons", () => {
    const { container } = render(
      <>
        <MemberCardSkeleton />
        <MemberCardSkeleton variant="grid" />
      </>,
    );

    expect(container.querySelectorAll("[data-slot=member-card-skeleton]")).toHaveLength(2);
  });
});

describe("MemberCard conversation starters", () => {
  it("shows the first line of the bio", () => {
    render(
      <MemberCard
        member={member({ bio: "Potter in Lisbon.\nTeaches wheel throwing on weekends." })}
        href="/m"
      />,
    );

    expect(screen.getByText("Potter in Lisbon.")).toBeTruthy();
    expect(screen.queryByText(/wheel throwing/)).toBeNull();
  });

  it("marks a member who joined recently as new", () => {
    const { rerender } = render(<MemberCard member={member({ isNew: true })} href="/m" />);
    expect(screen.getByText("New")).toBeTruthy();

    rerender(<MemberCard member={member({ isNew: false })} href="/m" />);
    expect(screen.queryByText("New")).toBeNull();
  });
});
