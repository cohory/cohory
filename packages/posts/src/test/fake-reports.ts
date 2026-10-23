import { newId } from "@cohory/db";
import type { ReportStatus } from "@cohory/db/schema";

import type { NewReport, ReportsStore, ReportTarget, ResolvedReport } from "../reports/store";

export interface FakeReport extends NewReport {
  readonly communityId: string;
  status: ReportStatus;
  resolvedBy: string | null;
}

export function createFakeReportsStore(communityId: string, reports: FakeReport[]): ReportsStore {
  const own = () => reports.filter((r) => r.communityId === communityId && r.status === "open");
  const sameTarget = (a: ReportTarget, b: ReportTarget) =>
    a.kind === "comment"
      ? b.kind === "comment" && a.commentId === b.commentId
      : b.kind === "post" && a.postId === b.postId;

  function close(matches: FakeReport[], status: ReportStatus, by: string): ResolvedReport[] {
    for (const report of matches) {
      report.status = status;
      report.resolvedBy = by;
    }
    return matches.map((report) => ({
      reporterId: report.reporterId,
      postId: report.target.postId,
      commentId: report.target.kind === "comment" ? report.target.commentId : null,
    }));
  }

  return {
    async actAs() {},
    async enableModeration() {},
    async insert(report) {
      if (
        own().some((r) => r.reporterId === report.reporterId && sameTarget(r.target, report.target))
      ) {
        return null;
      }
      reports.push({ ...report, communityId, status: "open", resolvedBy: null });
      return newId();
    },
    async listGroups() {
      return [];
    },
    async countOpenGroups() {
      return new Set(own().map((r) => JSON.stringify(r.target))).size;
    },
    async resolve(target, resolution) {
      return close(
        own().filter((r) => sameTarget(r.target, target)),
        resolution.status,
        resolution.resolvedBy,
      );
    },
    async resolveForPost(postId, resolution) {
      return close(
        own().filter((r) => r.target.postId === postId),
        resolution.status,
        resolution.resolvedBy,
      );
    },
    async resolveForComments(commentIds, resolution) {
      return close(
        own().filter((r) => r.target.kind === "comment" && commentIds.includes(r.target.commentId)),
        resolution.status,
        resolution.resolvedBy,
      );
    },
    async appendAudit() {},
  };
}
