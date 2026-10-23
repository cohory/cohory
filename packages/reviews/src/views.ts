import type { ReportReason, ReviewHiddenReason, ReviewReportStatus } from "@cohory/db/schema";

import type { Eligibility, ReviewerStatus } from "./eligibility";

export interface RatingCount {
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly count: number;
}

export interface HiddenReviewCount {
  readonly reason: ReviewHiddenReason;
  readonly count: number;
}

export type ReviewSummary =
  | { readonly status: "disabled" }
  | {
      readonly status: "enabled";
      readonly count: number;
      readonly average: number | null;
      readonly ratings: readonly RatingCount[];
      readonly hidden: readonly HiddenReviewCount[];
    };

export interface ReviewReplyView {
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

export interface ReviewAuthorView {
  readonly id: string | null;
  readonly name: string;
  readonly image: string | null;
}

export interface ReviewView {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly author: ReviewAuthorView;
  readonly status: ReviewerStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly reply: ReviewReplyView | null;
}

export interface ReviewPage {
  readonly data: readonly ReviewView[];
  readonly nextCursor: string | null;
}

export interface OwnReviewView {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly hiddenReason: ReviewHiddenReason | null;
}

export interface ReviewViewerState {
  readonly enabled: boolean;
  readonly signedIn: boolean;
  readonly ownReview: OwnReviewView | null;
  readonly eligibility: Eligibility | null;
  readonly eligibilityMessage: string | null;
  readonly canReply: boolean;
  readonly canReport: boolean;
  readonly canHide: boolean;
}

export interface ReviewReportGroupView {
  readonly reviewId: string;
  readonly rating: number;
  readonly excerpt: string;
  readonly authorName: string;
  readonly status: ReviewReportStatus;
  readonly reportCount: number;
  readonly reasons: readonly ReportReason[];
  readonly notes: readonly string[];
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
  readonly hiddenReason: ReviewHiddenReason | null;
}

export interface ReviewReportQueue {
  readonly data: readonly ReviewReportGroupView[];
  readonly openCount: number;
}
