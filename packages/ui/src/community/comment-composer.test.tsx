import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatCount } from "../lib/format-number";
import { CommentComposer } from "./comment-composer";

describe("CommentComposer", () => {
  it("announces the over limit count and ties it to the comment field", () => {
    render(<CommentComposer onSubmit={vi.fn()} maxLength={5} />);
    const field = screen.getByRole("textbox", { name: "Write a comment" });

    fireEvent.change(field, { target: { value: "Too long" } });

    const counter = screen.getByText("3 characters over the limit");
    expect(counter.closest("[aria-live='polite']")).not.toBeNull();
    expect(counter.className).toContain("tabular-nums");
    expect(field.getAttribute("aria-describedby")).toBe(counter.id);
  });

  it("formats a large overflow with the fixed app locale", () => {
    render(<CommentComposer onSubmit={vi.fn()} maxLength={1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Write a comment" }), {
      target: { value: "x".repeat(1_235) },
    });

    expect(screen.getByText(`${formatCount(1_234)} characters over the limit`)).toBeTruthy();
  });
});
