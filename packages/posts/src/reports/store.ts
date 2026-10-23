import type { CommunityRole } from "@cohory/authz";
import type { ReportReason, ReportStatus } from "@cohory/db/schema";

export type ReportTarget =
  | { readonly kind: "post"; readonly postId: string }
  | { readonly kind: "comment"; readonly postId: string; readonly commentId: string };

export type ReportResolution = Exclude<ReportStatus, "open">;

export interface NewReport {
  readonly target: ReportTarget;
  readonly reporterId: string;
  readonly reason: ReportReason;
  readonly note: string | null;
}

export interface ReportGroupRow {
  readonly target: ReportTarget;
  readonly status: ReportStatus;
  readonly reportCount: number;
  readonly reasons: readonly ReportReason[];
  readonly notes: readonly string[];
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedByName: string | null;
  readonly postTitle: string | null;
  readonly excerpt: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorRole: CommunityRole | null;
  readonly contentDeletedAt: Date | null;
}

export interface ReportGroupFilter {
  readonly open: boolean;
  readonly limit: number;
}

export interface ResolveReports {
  readonly status: ReportResolution;
  readonly resolvedBy: string;
  readonly at: Date;
}

export interface ResolvedReport {
  readonly reporterId: string;
  readonly postId: string;
  readonly commentId: string | null;
}

export interface ModerationAudit {
  readonly actorId: string;
  readonly action: string;
  readonly target: string;
  readonly metadata: Record<string, unknown>;
}

export interface ReportsStore {
  actAs(userId: string): Promise<void>;
  enableModeration(): Promise<void>;
  insert(report: NewReport): Promise<string | null>;
  listGroups(filter: ReportGroupFilter): Promise<ReportGroupRow[]>;
  countOpenGroups(): Promise<number>;
  resolve(target: ReportTarget, resolution: ResolveReports): Promise<ResolvedReport[]>;
  resolveForPost(postId: string, resolution: ResolveReports): Promise<ResolvedReport[]>;
  resolveForComments(
    commentIds: readonly string[],
    resolution: ResolveReports,
  ): Promise<ResolvedReport[]>;
  appendAudit(entry: ModerationAudit): Promise<void>;
}
