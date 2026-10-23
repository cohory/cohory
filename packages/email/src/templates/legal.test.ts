import { describe, expect, it } from "vitest";

import { renderQueuedEmail } from "../queue";
import { allCopy } from "../test/copy";
import { contentReportEmail, contentReportReceivedEmail, dataExportReadyEmail } from "./legal";

describe("dataExportReadyEmail", () => {
  const url = "http://localhost:3000/account/data-export/0199";
  const email = dataExportReadyEmail({ name: "Ada", url, expiresInDays: 7 });

  it("links the download and says how long it works and that sign in is needed", () => {
    expect(email.subject).toBe("Your Cohory data is ready to download");
    expect(email.text).toContain(url);
    expect(email.text).toContain("7 days");
    expect(email.text).toContain("signed in");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("contentReportEmail", () => {
  it("gives the operator the page, reason, details, and reporter", () => {
    const email = contentReportEmail({
      pageUrl: "http://localhost:3000/c/club/posts/1",
      reason: "Illegal content",
      details: "It shows <script>",
      reporterEmail: "reporter@example.com",
      reportedAt: "2026-10-22T10:00:00.000Z",
    });

    expect(email.subject).toBe("Content report: Illegal content");
    expect(email.text).toContain("http://localhost:3000/c/club/posts/1");
    expect(email.text).toContain("reporter@example.com");
    expect(email.html).not.toContain("<script>");
  });
});

describe("contentReportReceivedEmail", () => {
  it("tells the reporter that a decision with reasons follows, without linking the page", () => {
    const email = contentReportReceivedEmail();

    expect(email.text).toContain("email you what we decide and why");
    expect(email.text).not.toContain("Reported page");
    expect(email.html).not.toContain("/c/club");
  });
});

describe("queued content report", () => {
  it("lets the operator reply to the reporter directly", () => {
    const message = renderQueuedEmail({
      template: "content-report",
      to: "operator@example.com",
      data: {
        pageUrl: "http://localhost:3000/c/club",
        reason: "Copyright",
        details: "My photo",
        reporterEmail: "reporter@example.com",
        reportedAt: "2026-10-22T10:00:00.000Z",
      },
    });

    expect(message.headers).toEqual({ "Reply-To": "reporter@example.com" });
  });
});
