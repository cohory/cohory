import { describe, expect, it } from "vitest";

import { MigrationError } from "../errors";
import { detectDateOrder, parseDate, readJson } from "./tabular";

describe("readJson", () => {
  it("names the file and the line of broken JSON", () => {
    const file = { name: "posts.json", bytes: new TextEncoder().encode('[\n  {"id": 1,}\n]') };

    expect(() => readJson(file)).toThrow(
      new MigrationError("invalid_csv", "posts.json is not valid JSON at line 2."),
    );
  });
});

describe("parseDate", () => {
  it("rejects a slash date whose month or day does not exist instead of rolling it over", () => {
    expect(parseDate("13/45/2025")).toBeNull();
    expect(parseDate("02/30/2025")).toBeNull();
    expect(parseDate("13/45/2025", "dmy")).toBeNull();
  });

  it("rejects impossible ISO and naive dates and times", () => {
    expect(parseDate("2025-02-30")).toBeNull();
    expect(parseDate("2025-04-31T10:00:00.000Z")).toBeNull();
    expect(parseDate("2025-02-10 25:00:00")).toBeNull();
    expect(parseDate("2025-02-10 10:61")).toBeNull();
  });

  it("reads slash dates month first by default and day first when asked", () => {
    expect(parseDate("03/04/2025")?.toISOString()).toBe("2025-03-04T00:00:00.000Z");
    expect(parseDate("03/04/2025", "dmy")?.toISOString()).toBe("2025-04-03T00:00:00.000Z");
    expect(parseDate("25/12/2025 9:05 PM", "dmy")?.toISOString()).toBe("2025-12-25T21:05:00.000Z");
  });

  it("still reads valid ISO dates with an offset", () => {
    expect(parseDate("2025-05-01T10:00:00+02:00")?.toISOString()).toBe("2025-05-01T08:00:00.000Z");
    expect(parseDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("detectDateOrder", () => {
  it("picks day first when a first part is over 12", () => {
    expect(detectDateOrder(["03/04/2025", "25/04/2025", null])).toBe("dmy");
  });

  it("picks month first when a second part is over 12 or nothing decides", () => {
    expect(detectDateOrder(["03/04/2025", "04/25/2025"])).toBe("mdy");
    expect(detectDateOrder(["03/04/2025"])).toBe("mdy");
  });

  it("returns null when no value is a slash date", () => {
    expect(detectDateOrder(["2025-01-01", null, ""])).toBeNull();
  });
});
