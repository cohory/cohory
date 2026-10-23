import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { entry } from "./fixtures.test-utils";
import { Leaderboard, LeaderboardSkeleton, LevelLadder } from "./leaderboard";

function rows() {
  return within(screen.getByRole("list")).getAllByRole("listitem");
}

describe("Leaderboard", () => {
  it("lists entries with rank, name, level, and points", () => {
    render(
      <Leaderboard
        window="7d"
        onWindowChange={vi.fn()}
        entries={[entry(1, 1, 1200), entry(2, 2, 1)]}
      />,
    );

    const [first, second] = rows();
    expect(first?.textContent).toContain("Rank 1");
    expect(first?.textContent).toContain("Person 1");
    expect(first?.textContent).toContain("1,200 points");
    expect(within(first as HTMLElement).getByRole("img", { name: "Level 2" })).toBeTruthy();
    expect(second?.textContent).toContain("1 point");
  });

  it("shows shared ranks for ties", () => {
    render(
      <Leaderboard
        window="all"
        onWindowChange={vi.fn()}
        entries={[entry(1, 1, 300), entry(2, 2, 200), entry(2, 3, 200), entry(4, 4, 100)]}
      />,
    );

    expect(rows().map((row) => row.textContent?.match(/Rank (\d+)/)?.[1])).toEqual([
      "1",
      "2",
      "2",
      "4",
    ]);
  });

  it("shows at most 10 rows and pins the viewer when outside them", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      entry(index + 1, index + 1, 100 - index),
    );
    render(
      <Leaderboard
        window="7d"
        onWindowChange={vi.fn()}
        entries={entries}
        viewer={{ rank: 27, points: 15 }}
      />,
    );

    expect(rows()).toHaveLength(10);
    const pinned = screen.getByText("You").parentElement;
    expect(pinned?.textContent).toContain("Rank 27");
    expect(pinned?.textContent).toContain("15 points");
  });

  it("does not pin the viewer inside the top 10", () => {
    render(
      <Leaderboard
        window="7d"
        onWindowChange={vi.fn()}
        entries={[entry(1, 1, 50), entry(2, 2, 40)]}
        viewer={{ rank: 2, points: 40 }}
      />,
    );

    expect(screen.queryByText("You")).toBeNull();
  });

  it("switches between 7 days and All time", () => {
    const onWindowChange = vi.fn();
    render(<Leaderboard window="7d" onWindowChange={onWindowChange} entries={[]} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["7 days", "All time"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "All time" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(onWindowChange).toHaveBeenCalledWith("all");
  });

  it("shows the empty sentence without an exclamation mark", () => {
    render(<Leaderboard window="7d" onWindowChange={vi.fn()} entries={[]} />);

    const empty = screen.getByText("No points yet.");
    expect(empty.textContent).not.toContain("!");
  });

  it("renders an empty state when the leaderboard is turned off", () => {
    render(
      <Leaderboard window="7d" onWindowChange={vi.fn()} entries={[entry(1, 1, 10)]} disabled />,
    );

    expect(screen.getByText("Leaderboard is turned off for this community")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Person 1")).toBeNull();
  });

  it("has a loading skeleton", () => {
    render(<LeaderboardSkeleton />);

    expect(screen.getByRole("status", { name: "Loading leaderboard" })).toBeTruthy();
  });
});

describe("LevelLadder", () => {
  const thresholds = [0, 10, 30, 75, 150, 300, 600, 1200, 2500];
  const steps = thresholds.map((minPoints, index) => ({
    level: index + 1,
    name: index === 0 ? "Seed" : null,
    minPoints,
    share: index === 0 ? 75 : index === 1 ? 25 : 0,
  }));

  it("lists every level with its name, the points it starts at, and the share of members", () => {
    render(<LevelLadder steps={steps} currentLevel={2} locale="en-US" />);

    const list = screen.getByRole("list", { name: "Levels" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(9);
    expect(items[0]?.textContent).toContain("Level 1");
    expect(items[0]?.textContent).toContain("Seed");
    expect(items[0]?.textContent).toContain("75% of members");
    expect(items[8]?.textContent).toContain("2,500 points");
  });

  it("marks the viewer's level", () => {
    render(<LevelLadder steps={steps} currentLevel={2} />);

    const current = screen.getByText("You").closest("li");
    expect(current?.getAttribute("aria-current")).toBe("step");
    expect(current?.textContent).toContain("Level 2");
  });
});
