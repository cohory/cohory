import { describe, expect, it } from "vitest";

import { ReorderMismatchError } from "./errors";
import { appendPosition, planReorder, positionGap } from "./positions";

function rows(...positions: number[]) {
  return positions.map((position, index) => ({ id: `r${index}`, position }));
}

function apply(current: { id: string; position: number }[], ids: string[]) {
  const updates = new Map(planReorder(current, ids).map((u) => [u.id, u.position]));
  return ids.map((id) => updates.get(id) ?? current.find((row) => row.id === id)?.position ?? 0);
}

function strictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? 0));
}

describe("appendPosition", () => {
  it("starts at the gap and adds the gap after the last position", () => {
    expect(appendPosition(null)).toBe(positionGap);
    expect(appendPosition(3 * positionGap)).toBe(4 * positionGap);
    expect(positionGap).toBe(1024);
  });
});

describe("planReorder", () => {
  it("changes nothing when the order is the same", () => {
    expect(planReorder(rows(1024, 2048, 3072), ["r0", "r1", "r2"])).toEqual([]);
  });

  it("moves one item by touching only that row", () => {
    const current = rows(1024, 2048, 3072, 4096);
    const updates = planReorder(current, ["r3", "r0", "r1", "r2"]);

    expect(updates).toEqual([{ id: "r3", position: 512 }]);
  });

  it("places a moved item between its new neighbours", () => {
    const current = rows(1024, 2048, 3072, 4096);
    const order = ["r0", "r3", "r1", "r2"];

    expect(planReorder(current, order)).toEqual([{ id: "r3", position: 1536 }]);
    expect(strictlyIncreasing(apply(current, order))).toBe(true);
  });

  it("appends after the last item with a full gap", () => {
    expect(planReorder(rows(1024, 2048, 3072), ["r1", "r2", "r0"])).toEqual([
      { id: "r0", position: 4096 },
    ]);
  });

  it("compacts every row to 1024 steps when there is no gap left", () => {
    const current = rows(1, 2, 3, 4);
    const order = ["r0", "r2", "r1", "r3"];

    expect(planReorder(current, order)).toEqual([
      { id: "r0", position: 1024 },
      { id: "r2", position: 2048 },
      { id: "r1", position: 3072 },
      { id: "r3", position: 4096 },
    ]);
  });

  it("keeps positions strictly increasing for a full reversal", () => {
    const current = rows(1024, 2048, 3072, 4096, 5120);
    const order = ["r4", "r3", "r2", "r1", "r0"];

    expect(strictlyIncreasing(apply(current, order))).toBe(true);
  });

  it("compacts rows that share a position", () => {
    const current = rows(1024, 1024, 1024);

    expect(strictlyIncreasing(apply(current, ["r0", "r1", "r2"]))).toBe(true);
  });

  it.each([[["r0", "r1"]], [["r0", "r1", "r2", "r3"]], [["r0", "r1", "r1"]], [["r0", "r1", "zz"]]])(
    "rejects %j when it is not the full list of ids",
    (ids) => {
      expect(() => planReorder(rows(1024, 2048, 3072), ids)).toThrow(ReorderMismatchError);
    },
  );
});
