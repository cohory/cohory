import { describe, expect, it } from "vitest";

import { deviceLabel } from "./device";

describe("deviceLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
  ])("names the browser and system of %s", (userAgent, expected) => {
    expect(deviceLabel(userAgent)).toBe(expected);
  });

  it("returns null when nothing is recognized", () => {
    expect(deviceLabel("curl/8.0")).toBeNull();
    expect(deviceLabel(null)).toBeNull();
  });
});
