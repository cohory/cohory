import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommentThread } from "./comment-thread";
import { CommunityPost } from "./community-post";
import { DeletedNotice } from "./deleted-notice";
import { NOW, textDocument } from "./fixtures.test-utils";

const deletion = { byName: "Mo Derator", at: new Date(NOW.getTime() - 2 * 60_000) };

describe("DeletedNotice", () => {
  it("says who deleted the item and when, and hides the content until revealed", () => {
    render(
      <DeletedNotice noun="post" deletion={deletion} now={NOW}>
        <p>secret words</p>
      </DeletedNotice>,
    );

    expect(screen.getByText(/Deleted by Mo Derator/)).toBeTruthy();
    expect(screen.getByText("2 min ago")).toBeTruthy();
    expect(screen.queryByText("secret words")).toBeNull();

    const reveal = screen.getByRole("button", { name: "Show deleted post" });
    expect(reveal.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(reveal);

    expect(screen.getByText("secret words")).toBeTruthy();
    const hide = screen.getByRole("button", { name: "Hide deleted post" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    expect(screen.queryByText("secret words")).toBeNull();
  });

  it("falls back to a neutral label when the deleting account is gone", () => {
    render(
      <DeletedNotice noun="comment" deletion={{ byName: null, at: NOW }} now={NOW}>
        <p>x</p>
      </DeletedNotice>,
    );

    expect(screen.getByText(/Deleted by a removed account/)).toBeTruthy();
  });
});

describe("deleted content for moderators", () => {
  it("shows a deleted post with the notice instead of the plain placeholder", () => {
    render(
      <CommunityPost
        post={{
          id: "p1",
          title: "Gone",
          content: textDocument("secret"),
          createdAt: NOW,
          status: "deleted",
          deletion,
        }}
        author={{ id: "u1", name: "Ana Lima" }}
        likeCount={0}
        likedByViewer={false}
        commentCount={0}
        onLike={vi.fn()}
        now={NOW}
      />,
    );

    expect(screen.queryByText("This post was removed")).toBeNull();
    expect(screen.queryByText("secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show deleted post" }));
    expect(screen.getByText("secret")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Like/ })).toBeNull();
  });

  it("shows a deleted comment with the notice and keeps replies", () => {
    render(
      <CommentThread
        comments={[
          {
            id: "a",
            author: { id: "x", name: "Person a" },
            content: textDocument("Body a"),
            createdAt: NOW,
            likeCount: 0,
            likedByViewer: false,
            status: "deleted",
            deletion,
          },
        ]}
        onLike={vi.fn()}
        now={NOW}
      />,
    );

    expect(screen.getByText(/Deleted by Mo Derator/)).toBeTruthy();
    expect(screen.queryByText("Body a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show deleted comment" }));
    expect(screen.getByText("Body a")).toBeTruthy();
  });
});
