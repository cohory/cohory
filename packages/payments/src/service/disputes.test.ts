import { describe, expect, it } from "vitest";

import { nextDisputeStatus } from "./disputes";

describe("nextDisputeStatus", () => {
  it.each([
    [null, "open", "open"],
    [null, "lost", "lost"],
    ["open", "won", "won"],
    ["open", "lost", "lost"],
    ["won", "lost", "lost"],
  ] as const)("moves a %s dispute with a %s update to %s", (previous, incoming, next) => {
    expect(nextDisputeStatus(previous, incoming)).toBe(next);
  });

  it("never reopens a closed dispute from a late open update", () => {
    expect(nextDisputeStatus("lost", "open")).toBe("lost");
    expect(nextDisputeStatus("won", "open")).toBe("won");
  });
});
