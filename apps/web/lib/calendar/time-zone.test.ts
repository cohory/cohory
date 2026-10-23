import { describe, expect, it } from "vitest";

import { isTimeZone, resolveViewerTimeZone } from "./time-zone";

describe("viewer time zone", () => {
  it("uses a valid cookie zone first", () => {
    expect(resolveViewerTimeZone("America/New_York", "Europe/Berlin")).toBe("America/New_York");
  });

  it("decodes an encoded cookie value", () => {
    expect(resolveViewerTimeZone("Asia%2FTokyo", null)).toBe("Asia/Tokyo");
  });

  it("falls back to the event zone when the cookie is missing or invalid", () => {
    expect(resolveViewerTimeZone(undefined, "Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveViewerTimeZone("Not/AZone", "Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveViewerTimeZone("%E0%A4%A", "Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("falls back to UTC when neither zone is usable", () => {
    expect(resolveViewerTimeZone(null)).toBe("UTC");
    expect(resolveViewerTimeZone("", "Nowhere/Land")).toBe("UTC");
  });

  it("accepts IANA names only", () => {
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Etc/GMT+5")).toBe(true);
    expect(isTimeZone("+05:00")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });
});
