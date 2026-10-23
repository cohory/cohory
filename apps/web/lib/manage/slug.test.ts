import { describe, expect, it } from "vitest";

import { slugChangeDate } from "./slug";

describe("slug change copy", () => {
  it("names the day the URL can change again in UTC", () => {
    expect(slugChangeDate(new Date("2026-11-20T23:30:00.000Z"))).toBe("20 November 2026");
  });
});
