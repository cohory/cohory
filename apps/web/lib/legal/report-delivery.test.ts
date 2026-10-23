import { describe, expect, it, vi } from "vitest";

import type { ContentReport } from "./report";
import { deliverContentReport, type ReportOutbox } from "./report-delivery";

const report: ContentReport = {
  pageUrl: "https://app.example.com/c/club/posts/1",
  reason: "Illegal content",
  details: "This post sells counterfeit goods.",
  goodFaith: "on",
};

const at = new Date("2026-10-22T10:00:00.000Z");

function operatorEmail(reporterEmail: string | null) {
  return {
    template: "content-report",
    to: "operator@example.com",
    data: {
      pageUrl: report.pageUrl,
      reason: report.reason,
      details: report.details,
      reporterEmail,
      reportedAt: at.toISOString(),
    },
  };
}

function outbox() {
  return { send: vi.fn<ReportOutbox["send"]>().mockResolvedValue(undefined) };
}

describe("deliverContentReport", () => {
  it("sends an anonymous report to the operator and no receipt to anyone", async () => {
    const box = outbox();

    const result = await deliverContentReport(box, "operator@example.com", report, null, at);

    expect(result).toEqual({ receipt: false });
    expect(box.send.mock.calls).toEqual([[operatorEmail(null)]]);
  });

  it("sends the receipt only to a signed in reporter's own verified address", async () => {
    const box = outbox();

    const result = await deliverContentReport(
      box,
      "operator@example.com",
      report,
      { email: "ada@example.com", emailVerified: true },
      at,
    );

    expect(result).toEqual({ receipt: true });
    expect(box.send.mock.calls).toEqual([
      [operatorEmail("ada@example.com")],
      [{ template: "content-report-received", to: "ada@example.com", data: {} }],
    ]);
  });

  it("sends no receipt to a signed in reporter whose address is not confirmed", async () => {
    const box = outbox();

    const result = await deliverContentReport(
      box,
      "operator@example.com",
      report,
      { email: "ada@example.com", emailVerified: false },
      at,
    );

    expect(result).toEqual({ receipt: false });
    expect(box.send.mock.calls).toEqual([[operatorEmail(null)]]);
  });
});
