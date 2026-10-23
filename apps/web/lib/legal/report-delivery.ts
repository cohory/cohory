import type { EmailOutbox } from "@cohory/email";

import type { ContentReport } from "./report";

export type ReportOutbox = Pick<EmailOutbox, "send">;

export interface Reporter {
  readonly email: string;
  readonly emailVerified: boolean;
}

export async function deliverContentReport(
  outbox: ReportOutbox,
  contact: string,
  report: ContentReport,
  reporter: Reporter | null,
  at: Date,
): Promise<{ receipt: boolean }> {
  const receiptTo = reporter?.emailVerified ? reporter.email : null;
  await outbox.send({
    template: "content-report",
    to: contact,
    data: {
      pageUrl: report.pageUrl,
      reason: report.reason,
      details: report.details,
      reporterEmail: receiptTo,
      reportedAt: at.toISOString(),
    },
  });
  if (!receiptTo) {
    return { receipt: false };
  }
  await outbox.send({ template: "content-report-received", to: receiptTo, data: {} });
  return { receipt: true };
}
