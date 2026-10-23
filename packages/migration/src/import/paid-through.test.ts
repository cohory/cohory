import { describe, expect, it } from "vitest";

import { paidThrough } from "./paid-through";

describe("paidThrough", () => {
  const restoredAt = new Date("2026-12-01T09:00:00.000Z");

  it("keeps a paid period that ends more than a week after the restore", () => {
    expect(paidThrough("2026-12-31T00:00:00.000Z", restoredAt)).toEqual(
      new Date("2026-12-31T00:00:00.000Z"),
    );
  });

  it("gives a week after the restore when the period ended earlier", () => {
    expect(paidThrough("2026-11-18T00:00:00.000Z", restoredAt)).toEqual(
      new Date("2026-12-08T09:00:00.000Z"),
    );
  });

  it("leaves access open without a period end", () => {
    expect(paidThrough(null, restoredAt)).toBeNull();
  });
});
