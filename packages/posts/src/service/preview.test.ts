import { describe, expect, it } from "vitest";

import { notificationPreview } from "./preview";

describe("notificationPreview", () => {
  it("uses the title, else the first non empty line of the text", () => {
    expect(notificationPreview("Kiln day", "Body")).toBe("Kiln day");
    expect(notificationPreview(null, "\n  First line \nSecond")).toBe("First line");
    expect(notificationPreview("  ", "Fallback")).toBe("Fallback");
  });

  it("gives nothing for empty content and shortens long lines", () => {
    expect(notificationPreview(null, " \n ")).toBeUndefined();
    const long = notificationPreview(null, "word ".repeat(60));
    expect(long?.length).toBeLessThanOrEqual(140);
    expect(long?.endsWith("...")).toBe(true);
  });
});
