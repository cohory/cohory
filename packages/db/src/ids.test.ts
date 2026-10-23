import { describe, expect, it } from "vitest";

import { newId } from "./ids";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("returns a lowercase canonical UUID", () => {
    expect(newId()).toMatch(uuidPattern);
  });

  it("sets the version nibble to 7 and the RFC 9562 variant", () => {
    const id = newId();

    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("is strictly monotonic within a process", () => {
    const ids = Array.from({ length: 10_000 }, () => newId());
    const sorted = [...ids].sort();

    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("encodes the current time in the leading 48 bits", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const millis = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);

    expect(millis).toBeGreaterThanOrEqual(before);
    expect(millis).toBeLessThanOrEqual(after + 1);
  });
});
