import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommunityPost, CommunityPostSkeleton } from "./community-post";
import { NOW, textDocument } from "./fixtures.test-utils";

const author = { id: "u1", name: "Ana Lima" };

function renderPost(overrides: Partial<Parameters<typeof CommunityPost>[0]> = {}) {
  const onLike = vi.fn();
  render(
    <CommunityPost
      post={{
        id: "p1",
        title: "Week one recap",
        content: textDocument("Thanks for joining."),
        createdAt: new Date(NOW.getTime() - 5 * 60_000),
      }}
      author={author}
      likeCount={3}
      likedByViewer={false}
      commentCount={2}
      commentsHref="/c/design/posts/p1#comments"
      href="/c/design/posts/p1"
      onLike={onLike}
      now={NOW}
      {...overrides}
    />,
  );
  return { onLike };
}

describe("CommunityPost conversation life", () => {
  const post = {
    id: "p1",
    title: "Week one recap",
    content: textDocument("Thanks for joining."),
    createdAt: new Date(NOW.getTime() - 5 * 60_000),
  };

  it("names the author's staff role and nothing for members", () => {
    renderPost({ author: { ...author, role: "owner" } });
    expect(screen.getByText("Creator")).toBeTruthy();
    cleanup();

    renderPost({ author: { ...author, role: "member" } });
    expect(screen.queryByText("Creator")).toBeNull();
  });

  it("shows up to three recent commenters and when the last comment came", () => {
    const people = ["Bo", "Cy", "Di", "Ed"].map((name) => ({ id: name, name }));
    renderPost({
      post: {
        ...post,
        conversation: {
          recentCommenters: people,
          lastCommentAt: new Date(NOW.getTime() - 2 * 3_600_000),
        },
      },
    });

    const commenters = screen.getByRole("list", { name: "Recent commenters" });
    expect(commenters.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText(/Last comment/).textContent).toBe("Last comment 2 hours ago");
  });

  it("marks a post with activity since the last visit as new in the feed only", () => {
    renderPost({ post: { ...post, isNew: true } });
    expect(screen.getByText("New")).toBeTruthy();
    cleanup();

    renderPost({ post: { ...post, isNew: true }, variant: "detail" });
    expect(screen.queryByText("New")).toBeNull();
  });
});

describe("CommunityPost", () => {
  it("shows an Agent badge with the agent name when an agent wrote the post", () => {
    renderPost({ author: { ...author, agentName: "Drafter" } });

    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByTitle("Written by the agent Drafter")).toBeTruthy();
  });

  it("shows no Agent badge for people", () => {
    renderPost();

    expect(screen.queryByText("Agent")).toBeNull();
  });

  it("renders the author, time, title link, body, and counts", () => {
    renderPost();

    expect(screen.getByRole("article", { name: "Week one recap" })).toBeTruthy();
    expect(screen.getByText("Ana Lima")).toBeTruthy();
    expect(screen.getByText("5 min ago")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Week one recap" }).getAttribute("href")).toBe(
      "/c/design/posts/p1",
    );
    expect(screen.getByText("Thanks for joining.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 comments" })).toBeTruthy();
  });

  it("exposes the like toggle with aria-pressed and the count in its label", () => {
    const { onLike } = renderPost({ likedByViewer: true, likeCount: 1 });

    const like = screen.getByRole("button", { name: "Like, 1 like" });
    expect(like.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(like);
    expect(onLike).toHaveBeenCalledOnce();
  });

  it("shows aria-pressed false when the viewer has not liked", () => {
    renderPost();

    expect(screen.getByRole("button", { name: "Like, 3 likes" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("shows the pinned marker and level badge slot", () => {
    renderPost({
      post: {
        id: "p1",
        content: textDocument("Read this first."),
        createdAt: NOW,
        pinned: true,
      },
      levelBadge: <span>Level 3</span>,
    });

    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Level 3")).toBeTruthy();
  });

  it("collapses long bodies behind Show more", () => {
    const long = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}`);
    renderPost({
      post: { id: "p1", title: "Long", content: textDocument(...long), createdAt: NOW },
    });

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("does not offer Show more for short bodies", () => {
    renderPost();

    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("hides the overflow menu when no actions are allowed", () => {
    renderPost({ actions: [] });

    expect(screen.queryByRole("button", { name: "Post options" })).toBeNull();
  });

  it("renders the overflow menu trigger when actions are passed", () => {
    renderPost({ actions: [{ id: "delete", label: "Delete post", onSelect: vi.fn() }] });

    expect(screen.getByRole("button", { name: "Post options" })).toBeTruthy();
  });

  it("renders the deleted placeholder without content or actions", () => {
    renderPost({
      post: {
        id: "p1",
        title: "Gone",
        content: textDocument("secret"),
        createdAt: NOW,
        status: "deleted",
      },
    });

    expect(screen.getByText("This post was removed")).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a loading skeleton with a status role", () => {
    render(<CommunityPostSkeleton />);

    expect(screen.getByRole("status", { name: "Loading post" })).toBeTruthy();
  });
});
