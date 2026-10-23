import type { CreatorExitAction, CreatorExitReason, CreatorMoment } from "@cohory/db/schema";

export interface MomentCopy {
  readonly label: string;
  readonly question: string;
}

export const momentCopy: Readonly<Record<CreatorMoment, MomentCopy>> = {
  first_post: { label: "First post", question: "How easy was it to publish your first post?" },
  first_paid_member: {
    label: "First paid member",
    question: "How easy was it to get your first paid member?",
  },
  first_course: {
    label: "First course",
    question: "How easy was it to publish your first course?",
  },
};

export const easeScale = { low: "Very hard", high: "Very easy" } as const;

export const easierPrompt = "What would have made it easier?";

export const exitActionLabels: Readonly<Record<CreatorExitAction, string>> = {
  archive_community: "Archived a community",
  delete_community: "Deleted a community",
  disconnect_stripe: "Disconnected Stripe",
  delete_account: "Deleted their account",
};

export const exitReasonLabels: Readonly<Record<CreatorExitReason, string>> = {
  too_expensive: "Too expensive",
  missing_feature: "Missing a feature I need",
  too_hard: "Too hard to use",
  moving_platform: "Moving to another platform",
  not_enough_activity: "Not enough members or activity",
  only_testing: "Only testing",
  other: "Other",
};
