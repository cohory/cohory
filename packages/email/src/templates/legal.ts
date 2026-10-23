import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

export interface DataExportReadyInput {
  readonly name: string;
  readonly url: string;
  readonly expiresInDays: number;
}

export function dataExportReadyEmail({
  name,
  url,
  expiresInDays,
}: DataExportReadyInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "data-export-ready",
    subject: `Your ${instance} data is ready to download`,
    preheader: `The link works for ${expiresInDays} days.`,
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `Your data is ready. The link works for ${expiresInDays} days, and you need to be signed in to ${instance} to use it.`,
    ],
    cta: { label: "Download your data", url },
    after: ["If you did not ask for this, change your password from Security."],
  });
}

export interface ContentReportInput {
  readonly pageUrl: string;
  readonly reason: string;
  readonly details: string;
  readonly reporterEmail: string | null;
  readonly reportedAt: string;
}

export function contentReportEmail(input: ContentReportInput): EmailContent {
  return buildEmail({
    template: "content-report",
    subject: `Content report: ${input.reason}`,
    preheader: input.pageUrl,
    brand: { kind: "instance" },
    body: [
      "Someone reported content through the public report form.",
      { kind: "link", label: "Reported page", url: input.pageUrl },
      `Reason: ${input.reason}`,
      `Details: ${input.details}`,
      `Reporter: ${input.reporterEmail ?? "No email given"}`,
      `Received: ${input.reportedAt}`,
      "Decide, act, and send the reporter and the person affected a statement of reasons.",
    ],
  });
}

export function contentReportReceivedEmail(): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "content-report-received",
    subject: `We received your report`,
    preheader: "We review it and tell you what we decide.",
    brand: { kind: "instance" },
    body: [
      `Thanks for reporting content on ${instance}. We review it and email you what we decide and why.`,
    ],
  });
}
