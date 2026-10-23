import type { CommunityRole } from "@cohory/authz";
import type { ReportReason, ReportStatus } from "@cohory/db/schema";

import type { ReportGroupRow } from "./store";

export interface ReportReceipt {
  readonly status: "received";
}

export interface ReportedContentView {
  readonly type: "post" | "comment";
  readonly id: string;
  readonly postId: string;
  readonly postTitle: string | null;
  readonly excerpt: string;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly role: CommunityRole | null;
  };
  readonly deletedAt: Date | null;
}

export interface ReportGroupView {
  readonly content: ReportedContentView;
  readonly status: ReportStatus;
  readonly reportCount: number;
  readonly reasons: readonly ReportReason[];
  readonly notes: readonly string[];
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
}

export interface ReportQueue {
  readonly data: readonly ReportGroupView[];
  readonly openCount: number;
}

export interface ReportResolutionResult {
  readonly resolved: number;
}

export function toReportGroupView(row: ReportGroupRow): ReportGroupView {
  const { target } = row;
  return {
    content: {
      type: target.kind,
      id: target.kind === "comment" ? target.commentId : target.postId,
      postId: target.postId,
      postTitle: row.postTitle,
      excerpt: row.excerpt,
      author: { id: row.authorId, name: row.authorName, role: row.authorRole },
      deletedAt: row.contentDeletedAt,
    },
    status: row.status,
    reportCount: row.reportCount,
    reasons: row.reasons,
    notes: row.notes,
    firstReportedAt: row.firstReportedAt,
    lastReportedAt: row.lastReportedAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedByName,
  };
}
