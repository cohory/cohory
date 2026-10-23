import { describe, expect, it } from "vitest";

import { parseContentReport } from "./report";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  pageUrl: "https://app.example.com/c/club/posts/1",
  reason: "Illegal content",
  details: "This post sells counterfeit goods.",
  goodFaith: "on",
};

describe("parseContentReport", () => {
  it("takes no email address from the form, so nobody can send a receipt to someone else", () => {
    const parsed = parseContentReport(form({ ...valid, email: "victim@example.com" }));
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual([
      "details",
      "goodFaith",
      "pageUrl",
      "reason",
    ]);
  });

  it("requires the good faith statement", () => {
    const parsed = parseContentReport(form({ ...valid, goodFaith: "" }));
    expect(parsed.error?.issues[0]?.message).toBe(
      "Confirm that the report is accurate and made in good faith.",
    );
  });

  it.each([
    ["pageUrl", "javascript:alert(1)"],
    ["reason", "Because"],
    ["details", "short"],
  ])("refuses an invalid %s", (field, value) => {
    expect(parseContentReport(form({ ...valid, [field]: value })).success).toBe(false);
  });
});
