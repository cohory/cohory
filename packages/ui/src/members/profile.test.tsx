import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivityList } from "./activity-list";
import { member, NOW } from "./fixtures.test-utils";
import { MemberProfileHeader } from "./member-profile-header";

describe("MemberProfileHeader", () => {
  it("renders identity, level progress, and bio", () => {
    render(
      <MemberProfileHeader
        member={member({ role: "admin" })}
        bio="Designer in Lisbon."
        canEdit={false}
        nextLevelAt={200}
        locale="en-US"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Ana Lima" })).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Level 3, Regular" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "120 of 200 points to Level 4" })).toBeTruthy();
    expect(screen.getByText("Designer in Lisbon.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bio/ })).toBeNull();
  });

  it("edits the bio inline with Save bio and Cancel", async () => {
    const onEditBio = vi.fn().mockResolvedValue(undefined);
    render(<MemberProfileHeader member={member()} bio="Old bio" canEdit onEditBio={onEditBio} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit bio" }));
    const field = screen.getByRole("textbox", { name: "Bio" });
    fireEvent.change(field, { target: { value: "  New bio  " } });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save bio" }));
    });
    expect(onEditBio).toHaveBeenCalledWith("New bio");
    expect(screen.queryByRole("textbox", { name: "Bio" })).toBeNull();
  });

  it("keeps the editor open with an inline error when saving fails", async () => {
    const onEditBio = vi.fn().mockRejectedValue(new Error("nope"));
    render(<MemberProfileHeader member={member()} canEdit onEditBio={onEditBio} />);

    fireEvent.click(screen.getByRole("button", { name: "Add bio" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save bio" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("Couldn't save your bio. Try again.");
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeTruthy();
  });

  it("cancels without saving", () => {
    const onEditBio = vi.fn();
    render(<MemberProfileHeader member={member()} bio="Old" canEdit onEditBio={onEditBio} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit bio" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onEditBio).not.toHaveBeenCalled();
    expect(screen.getByText("Old")).toBeTruthy();
  });

  it("hides level and progress when gamification is turned off", () => {
    render(<MemberProfileHeader member={member()} canEdit={false} gamificationEnabled={false} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("img", { name: /Level/ })).toBeNull();
  });
});

describe("ActivityList", () => {
  it("lists posts and comments with links and relative times", () => {
    render(
      <ActivityList
        now={NOW}
        items={[
          {
            type: "post",
            title: "Hello everyone",
            href: "/c/demo/posts/1",
            createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
          },
          { type: "comment", excerpt: "Great point", href: "/c/demo/posts/2#c1", createdAt: NOW },
        ]}
      />,
    );

    const post = screen.getByRole("link", { name: /Hello everyone/ });
    expect(post.getAttribute("href")).toBe("/c/demo/posts/1");
    expect(post.textContent).toContain("Posted");
    expect(post.textContent).toContain("2 hours ago");
    expect(screen.getByRole("link", { name: /Great point/ }).textContent).toContain("Commented");
  });

  it("shows an empty state", () => {
    render(<ActivityList items={[]} />);

    expect(screen.getByText("No posts or comments yet.")).toBeTruthy();
  });
});
