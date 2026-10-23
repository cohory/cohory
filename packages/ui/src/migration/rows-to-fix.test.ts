import { describe, expect, it } from "vitest";

import { rowsToFixCsv } from "./rows-to-fix";

describe("rowsToFixCsv", () => {
  it("writes the original columns plus a reason, quoted and guarded against formulas", () => {
    expect(
      rowsToFixCsv([
        { location: "Row 3", reason: "Not valid.", values: { email: "nope", name: 'Bo, "B"' } },
        { location: "Row 4", reason: "Duplicate.", values: { email: "=cmd", role: "admin" } },
        { location: "posts.json, item 2", reason: "No text." },
      ]),
    ).toBe(
      [
        "email,name,role,reason",
        'nope,"Bo, ""B""",,Not valid.',
        "'=cmd,,admin,Duplicate.",
        ',,,"posts.json, item 2: No text."',
        "",
      ].join("\r\n"),
    );
  });
});
