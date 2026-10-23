import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { member } from "./fixtures.test-utils";
import { LevelFilter, MemberList, MemberSearch } from "./member-directory";

describe("MemberSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("has an accessible label and debounces changes", () => {
    const onChange = vi.fn();
    render(<MemberSearch value="" onChange={onChange} debounceMs={300} />);

    const input = screen.getByRole("searchbox", { name: "Search members" });
    fireEvent.change(input, { target: { value: "an" } });
    fireEvent.change(input, { target: { value: "ana" } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("ana");
  });

  it("clears immediately and returns focus to the input", () => {
    const onChange = vi.fn();
    render(<MemberSearch value="ana" onChange={onChange} placeholder="Find people" />);

    const input = screen.getByRole("searchbox", { name: "Search members" });
    expect(input.getAttribute("placeholder")).toBe("Find people");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("follows the value prop when the caller changes it", () => {
    const { rerender } = render(<MemberSearch value="" onChange={vi.fn()} />);
    rerender(<MemberSearch value="ben" onChange={vi.fn()} />);

    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("ben");
  });
});

describe("LevelFilter", () => {
  it("offers all levels and reports the chosen level", () => {
    const onChange = vi.fn();
    render(
      <LevelFilter
        value={null}
        onChange={onChange}
        levels={[{ level: 1, name: "Newcomer" }, { level: 2 }]}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Filter by level" });
    expect(screen.getByRole("option", { name: "All levels" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Level 1, Newcomer" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("MemberList", () => {
  const items = [
    { member: member(), href: "/m/ana" },
    { member: member({ userId: "u2", name: "Ben Ito", username: null }), href: "/m/ben" },
  ];

  it("renders a card per member and a load more button", () => {
    const onLoadMore = vi.fn();
    render(<MemberList members={items} variant="grid" hasMore onLoadMore={onLoadMore} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show more members" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("shows pending state on the load more button", () => {
    render(<MemberList members={items} hasMore onLoadMore={vi.fn()} loadingMore />);

    const button = screen.getByRole("button", { name: "Loading members…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("renders the empty state and the loading skeleton", () => {
    const { rerender } = render(
      <MemberList members={[]} emptyState={<p>No members match your search.</p>} />,
    );
    expect(screen.getByText("No members match your search.")).toBeTruthy();

    rerender(<MemberList members={[]} loading />);
    expect(screen.getByRole("status", { name: "Loading members" })).toBeTruthy();
  });
});
