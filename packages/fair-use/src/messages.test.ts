import { describe, expect, it } from "vitest";

import { LimitReachedError } from "./errors";
import { formatBytes, formatMembers, limitReachedMessage } from "./messages";

describe("fair use messages", () => {
  it("formats byte counts in binary units", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(500 * 1024 ** 2)).toBe("500 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
  });

  it("pluralizes member counts", () => {
    expect(formatMembers(1)).toBe("1 member");
    expect(formatMembers(1000)).toBe("1,000 members");
  });

  it("states the limit and what to do for each resource", () => {
    expect(limitReachedMessage(new LimitReachedError("members", 1000, 1000))).toBe(
      "This community has reached its limit of 1,000 members, so it can't take new members right now.",
    );
    expect(limitReachedMessage(new LimitReachedError("storage", 5 * 1024 ** 3, 1))).toContain(
      "used its 5 GB of file storage",
    );
    expect(limitReachedMessage(new LimitReachedError("upload", 500 * 1024 ** 2, 1))).toBe(
      "This file is larger than the 500 MB limit for one upload. Choose a smaller file.",
    );
  });
});
