import type { ReportReason, ReportStatus } from "@cohory/db/schema";

export const reportReasonLabels: Readonly<Record<ReportReason, string>> = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  other: "Something else",
};

export const reportStatusLabels: Readonly<Record<Exclude<ReportStatus, "open">, string>> = {
  dismissed: "Dismissed",
  content_removed: "Content deleted",
  member_banned: "Author banned",
};

export const reportReasonOrder: readonly ReportReason[] = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "other",
];
