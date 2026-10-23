import type { MigrationJobView } from "@cohory/migration";
import { describe, expect, it } from "vitest";

import { importRan, needsYouItems, nextStep, trendOf } from "./overview";

function job(
  kind: MigrationJobView["kind"],
  status: MigrationJobView["status"],
): Pick<MigrationJobView, "kind" | "status"> {
  return { kind, status };
}

describe("needsYouItems", () => {
  it("lists only queues with someone waiting, each linking to its Inbox tab", () => {
    const items = needsYouItems(
      { joinRequests: 3, reports: 0, failedPayments: 1, agentRequests: 2 },
      "makers",
    );
    expect(items).toEqual([
      {
        key: "joinRequests",
        label: "3 join requests",
        href: "/c/makers/manage/inbox?tab=requests",
      },
      { key: "failedPayments", label: "1 payment failed", href: "/c/makers/manage/payments" },
      {
        key: "agentRequests",
        label: "2 agent requests",
        href: "/c/makers/manage/inbox?tab=approvals",
      },
    ]);
  });

  it("is empty when nothing is waiting", () => {
    expect(
      needsYouItems({ joinRequests: 0, reports: 0, failedPayments: 0, agentRequests: 0 }, "m"),
    ).toEqual([]);
  });

  it("uses the singular for one report", () => {
    const [item] = needsYouItems(
      { joinRequests: 0, reports: 1, failedPayments: 0, agentRequests: 0 },
      "m",
    );
    expect(item?.label).toBe("1 report");
  });
});

describe("trendOf", () => {
  it("says how much a number went up or down against the earlier period", () => {
    expect(trendOf(12, 9, "last week")).toEqual({ direction: "up", text: "Up 3 from last week" });
    expect(trendOf(2, 5, "last month")).toEqual({
      direction: "down",
      text: "Down 3 from last month",
    });
    expect(trendOf(4, 4, "last week")).toEqual({ direction: "flat", text: "Same as last week" });
  });

  it("formats the change with the given formatter", () => {
    expect(trendOf(1500, 1000, "last month", (value) => `$${value / 100}`).text).toBe(
      "Up $5 from last month",
    );
  });
});

describe("importRan", () => {
  it("counts a finished community or members import, not an export", () => {
    expect(importRan([job("export", "succeeded")])).toBe(false);
    expect(importRan([job("import", "failed")])).toBe(false);
    expect(importRan([job("members_csv", "succeeded")])).toBe(true);
  });
});

describe("nextStep", () => {
  it("points at the first step that is not done", () => {
    const step = nextStep({
      hidden: false,
      doneCount: 1,
      steps: [
        { key: "branding", done: true, href: "/a" },
        { key: "about", done: false, href: "/b" },
      ],
    });
    expect(step?.key).toBe("about");
  });
});
