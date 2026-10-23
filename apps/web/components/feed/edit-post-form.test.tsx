import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updatePostAction } from "../../lib/posts/actions";
import type { FeedPost } from "../../lib/posts/views";
import { EditPostForm } from "./edit-post-form";

vi.mock("../../lib/posts/actions", () => ({ updatePostAction: vi.fn() }));

const updatePost = vi.mocked(updatePostAction);

afterEach(() => {
  vi.clearAllMocks();
});

const post: FeedPost = {
  id: "0192d3c0-0000-7000-8000-0000000000p1",
  title: "Weekly wins",
  category: null,
  content: { type: "doc", content: [] },
  author: { id: "u1", name: "Rosa", avatarUrl: null },
  authorRole: null,
  conversation: null,
  lastActivityAt: "2026-10-22T10:00:00.000Z",
  byViewer: false,
  viewerFollows: false,
  createdAt: "2026-10-22T10:00:00.000Z",
  edited: false,
  pinned: false,
  likeCount: 0,
  likedByViewer: false,
  commentCount: 0,
  actions: [],
  deletion: null,
};

function setup() {
  const onDone = vi.fn();
  render(
    <EditPostForm slug="design" post={post} resolveMention={async () => null} onDone={onDone} />,
  );
  return { onDone };
}

const body = () => screen.getByRole("textbox", { name: "Post" });

describe("EditPostForm", () => {
  it("does not hang when the request fails, and keeps the edit", async () => {
    updatePost.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onDone } = setup();
    fireEvent.change(body(), { target: { value: "One win this week" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't save your changes. Check your connection and try again.",
    );
    expect(body()).toHaveProperty("value", "One win this week");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("warns before leaving with an unsaved edit", () => {
    setup();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    fireEvent.change(body(), { target: { value: "Changed" } });
    expect(leave()).toBe(true);
  });

  it("keeps the action bar above the phone tab bar", () => {
    setup();

    const bar = screen.getByRole("button", { name: "Save changes" }).parentElement;
    expect(bar?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
  });
});
