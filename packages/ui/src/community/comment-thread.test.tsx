import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommentThread, CommentThreadSkeleton, type CommentThreadComment } from "./comment-thread";
import { NOW, textDocument } from "./fixtures.test-utils";

function comment(id: string, overrides: Partial<CommentThreadComment> = {}): CommentThreadComment {
  return {
    id,
    author: { id: `author-${id}`, name: `Person ${id}` },
    content: textDocument(`Body ${id}`),
    createdAt: NOW,
    likeCount: 0,
    likedByViewer: false,
    ...overrides,
  };
}

describe("CommentThread", () => {
  it("nests replies one level under their top level comment", () => {
    render(
      <CommentThread
        comments={[
          comment("a"),
          comment("b", { parentId: "a" }),
          comment("c", { parentId: "b" }),
          comment("d"),
        ]}
        onLike={vi.fn()}
        now={NOW}
      />,
    );

    const first = screen.getByRole("article", { name: "Comment by Person a" }).closest("li");
    if (!first) throw new Error("missing comment item");
    const nested = within(first)
      .getAllByRole("article")
      .map((node) => node.getAttribute("aria-label"));
    expect(nested).toEqual(["Comment by Person a", "Comment by Person b", "Comment by Person c"]);
  });

  it("renders the like toggle state per comment", () => {
    const onLike = vi.fn();
    render(
      <CommentThread
        comments={[comment("a", { likeCount: 2, likedByViewer: true })]}
        onLike={onLike}
        now={NOW}
      />,
    );

    const like = screen.getByRole("button", { name: "Like, 2 likes" });
    expect(like.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(like);
    expect(onLike).toHaveBeenCalledWith("a");
  });

  it("shows the deleted placeholder and keeps its replies", () => {
    render(
      <CommentThread
        comments={[comment("a", { status: "deleted" }), comment("b", { parentId: "a" })]}
        onLike={vi.fn()}
        now={NOW}
      />,
    );

    expect(screen.getByText("This comment was deleted")).toBeTruthy();
    expect(screen.queryByText("Body a")).toBeNull();
    expect(screen.getByText("Body b")).toBeTruthy();
  });

  it("opens an inline reply composer and submits to the top level parent", async () => {
    const onReply = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentThread
        comments={[comment("a"), comment("b", { parentId: "a" })]}
        onLike={vi.fn()}
        onReply={onReply}
        now={NOW}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1] as HTMLElement);
    const box = screen.getByRole("textbox", { name: "Reply to Person a" });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "Agreed" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Post" })));

    expect(onReply).toHaveBeenCalledWith({
      parentId: "a",
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Agreed" }] }],
      },
    });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("closes the reply composer with Escape and returns focus to Reply", () => {
    render(
      <CommentThread comments={[comment("a")]} onLike={vi.fn()} onReply={vi.fn()} now={NOW} />,
    );

    const reply = screen.getByRole("button", { name: "Reply" });
    fireEvent.click(reply);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(reply);
  });

  it("disables the reply Post button while empty", () => {
    render(
      <CommentThread comments={[comment("a")]} onLike={vi.fn()} onReply={vi.fn()} now={NOW} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByRole("button", { name: "Post" })).toHaveProperty("disabled", true);
  });

  it("shows load more and new comment controls", () => {
    const onLoadMore = vi.fn();
    const onShowNew = vi.fn();
    render(
      <CommentThread
        comments={[comment("a")]}
        onLike={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
        pendingNewCount={2}
        onShowNew={onShowNew}
        now={NOW}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show more comments" }));
    fireEvent.click(screen.getByRole("button", { name: "2 new comments" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onShowNew).toHaveBeenCalledOnce();
  });

  it("shows the empty state without comments", () => {
    render(<CommentThread comments={[]} onLike={vi.fn()} />);

    expect(screen.getByText("No comments yet")).toBeTruthy();
  });

  it("renders a skeleton with three rows by default", () => {
    const { container } = render(<CommentThreadSkeleton />);

    expect(screen.getByRole("status", { name: "Loading comments" })).toBeTruthy();
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(3);
  });
});
