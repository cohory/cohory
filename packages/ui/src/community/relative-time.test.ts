import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const now = new Date(2026, 9, 18, 12, 0, 0);

function ago(milliseconds: number): Date {
  return new Date(now.getTime() - milliseconds);
}

describe("formatRelativeTime", () => {
  it.each([
    [ago(20_000), "Just now"],
    [ago(5 * 60_000), "5 min ago"],
    [ago(60 * 60_000), "1 hour ago"],
    [ago(3 * 60 * 60_000), "3 hours ago"],
    [new Date(2026, 9, 17, 8, 0, 0), "Yesterday"],
    [new Date(2026, 9, 14, 8, 0, 0), "4 days ago"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatRelativeTime(date, now)).toBe(expected);
  });

  it("switches to an absolute date after a week", () => {
    expect(formatRelativeTime(new Date(2026, 8, 3), now, "en-GB")).toBe("3 September 2026");
  });
});
