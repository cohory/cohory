import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatCount } from "../lib/format-number";
import { LikeButton } from "./like-button";

describe("LikeButton", () => {
  it("formats the count with the fixed app locale in the label and the visible number", () => {
    render(<LikeButton liked={false} count={1_234} onToggle={vi.fn()} />);

    const button = screen.getByRole("button", { name: `Like, ${formatCount(1_234)} likes` });
    expect(button.textContent).toBe(formatCount(1_234));
  });

  it("keeps the count width steady as digits change", () => {
    render(<LikeButton liked count={9} onToggle={vi.fn()} />);

    expect(screen.getByText("9").className).toContain("tabular-nums");
  });
});
