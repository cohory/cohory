import { appendAuditEntry, setRlsFlag, setRlsValue, type ScopedQueries } from "@cohory/db";
import { contentReports, memberRole, reportReason, reportStatus } from "@cohory/db/schema";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type {
  ReportGroupRow,
  ReportsStore,
  ReportTarget,
  ResolvedReport,
  ResolveReports,
} from "./store";

const excerptLength = 280;
const notesPerGroup = 3;

const groupRowSchema = z.object({
  post_id: z.string(),
  comment_id: z.string().nullable(),
  status: z.enum(reportStatus.enumValues),
  report_count: z.coerce.number().int(),
  reasons: z.array(z.enum(reportReason.enumValues)),
  notes: z.array(z.string()).nullable(),
  first_reported_at: z.coerce.date(),
  last_reported_at: z.coerce.date(),
  resolved_at: z.coerce.date().nullable(),
  resolved_by_name: z.string().nullable(),
  post_title: z.string().nullable(),
  excerpt: z.string().nullable(),
  author_id: z.string(),
  author_name: z.string(),
  author_role: z.enum(memberRole.enumValues).nullable(),
  content_deleted_at: z.coerce.date().nullable(),
});

function toGroupRow(raw: unknown): ReportGroupRow {
  const row = groupRowSchema.parse(raw);
  return {
    target: row.comment_id
      ? { kind: "comment", postId: row.post_id, commentId: row.comment_id }
      : { kind: "post", postId: row.post_id },
    status: row.status,
    reportCount: row.report_count,
    reasons: row.reasons,
    notes: (row.notes ?? []).slice(0, notesPerGroup),
    firstReportedAt: row.first_reported_at,
    lastReportedAt: row.last_reported_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name,
    postTitle: row.post_title,
    excerpt: (row.excerpt ?? "").slice(0, excerptLength),
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    contentDeletedAt: row.content_deleted_at,
  };
}

function targetCondition(target: ReportTarget): SQL {
  return target.kind === "comment"
    ? eq(contentReports.commentId, target.commentId)
    : (and(eq(contentReports.postId, target.postId), isNull(contentReports.commentId)) ??
        sql`false`);
}

export function createReportsStore({
  tx,
  where,
  values,
  communityId,
}: ScopedQueries): ReportsStore {
  async function resolveWhere(
    condition: SQL,
    resolution: ResolveReports,
  ): Promise<ResolvedReport[]> {
    return tx
      .update(contentReports)
      .set({
        status: resolution.status,
        resolvedBy: resolution.resolvedBy,
        resolvedAt: resolution.at,
        updatedAt: resolution.at,
      })
      .where(where(contentReports, eq(contentReports.status, "open"), condition))
      .returning({
        reporterId: contentReports.reporterId,
        postId: contentReports.postId,
        commentId: contentReports.commentId,
      });
  }

  return {
    async actAs(userId) {
      await setRlsValue(tx, "user_id", userId);
    },

    async enableModeration() {
      await setRlsFlag(tx, "community_manager");
    },

    async insert(report) {
      const rows = await tx
        .insert(contentReports)
        .values(
          values({
            postId: report.target.postId,
            commentId: report.target.kind === "comment" ? report.target.commentId : null,
            reporterId: report.reporterId,
            reason: report.reason,
            note: report.note,
            status: "open" as const,
          }),
        )
        .onConflictDoNothing()
        .returning({ id: contentReports.id });
      return rows[0]?.id ?? null;
    },

    async listGroups({ open, limit }) {
      const statusFilter = open ? sql`r.status = 'open'` : sql`r.status <> 'open'`;
      const order = open
        ? sql`max(r.created_at) desc, r.post_id, r.comment_id`
        : sql`r.resolved_at desc, r.post_id, r.comment_id`;
      const result = await tx.execute(sql`
        select r.post_id, r.comment_id, r.status,
          count(*)::integer as report_count,
          array_agg(distinct r.reason::text) as reasons,
          array_remove(array_agg(r.note order by r.created_at desc), null) as notes,
          min(r.created_at) as first_reported_at,
          max(r.created_at) as last_reported_at,
          r.resolved_at,
          rv.name as resolved_by_name,
          p.title as post_title,
          case when r.comment_id is null then p.excerpt else left(c.body_text, ${excerptLength}) end as excerpt,
          a.id as author_id,
          a.name as author_name,
          case when am.status = 'active' then am.role end as author_role,
          case when r.comment_id is null then p.deleted_at else coalesce(c.deleted_at, p.deleted_at) end as content_deleted_at
        from content_reports r
        join posts p on p.id = r.post_id and p.community_id = r.community_id
        left join comments c on c.id = r.comment_id and c.community_id = r.community_id
        join users a on a.id = coalesce(c.author_id, p.author_id)
        left join memberships am on am.community_id = r.community_id and am.user_id = a.id
        left join users rv on rv.id = r.resolved_by
        where r.community_id = ${communityId} and ${statusFilter}
        group by r.post_id, r.comment_id, r.status, r.resolved_at, rv.name, p.title, p.excerpt,
          c.body_text, a.id, a.name, am.status, am.role, p.deleted_at, c.deleted_at
        order by ${order}
        limit ${limit}`);
      return result.rows.map(toGroupRow);
    },

    async countOpenGroups() {
      const result = await tx.execute(sql`
        select count(distinct (r.post_id, r.comment_id))::integer as value
        from content_reports r
        where r.community_id = ${communityId} and r.status = 'open'`);
      const [row] = z.array(z.object({ value: z.coerce.number().int() })).parse(result.rows);
      return row?.value ?? 0;
    },

    resolve(target, resolution) {
      return resolveWhere(targetCondition(target), resolution);
    },

    resolveForPost(postId, resolution) {
      return resolveWhere(eq(contentReports.postId, postId), resolution);
    },

    async resolveForComments(commentIds, resolution) {
      if (commentIds.length === 0) {
        return [];
      }
      return resolveWhere(inArray(contentReports.commentId, [...commentIds]), resolution);
    },

    async appendAudit(entry) {
      await appendAuditEntry({ tx, values }, entry);
    },
  };
}
