import { assertCan, can, ForbiddenError, type Actor } from "@cohory/authz";
import { newId } from "@cohory/db";

import { CommentNotFoundError, PostNotFoundError } from "../errors";
import { isLivePost } from "./live";
import {
  reportInputSchema,
  reportQueueInputSchema,
  reportQueueLimit,
  reportTargetInputSchema,
  type ReportInput,
  type ReportQueueInput,
  type ReportTargetInput,
} from "../reports/schemas";
import type { ReportResolution, ReportTarget, ResolvedReport } from "../reports/store";
import type { PostEvent } from "../events";
import {
  toReportGroupView,
  type ReportQueue,
  type ReportReceipt,
  type ReportResolutionResult,
} from "../reports/views";
import type { PostsStore } from "../repository";
import {
  isUuid,
  parseOrThrow,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Runtime,
} from "./context";

export interface ModerationContext {
  readonly actor: Actor;
  readonly access: Access;
  readonly userId: string;
  readonly at: Date;
}

function outcomeEvents(
  communityId: string,
  resolved: readonly ResolvedReport[],
  resolution: ReportResolution,
  resolvedBy: string,
): PostEvent[] {
  const bySubject = new Map<
    string,
    { postId: string; commentId: string | null; reporters: Set<string> }
  >();
  for (const report of resolved) {
    const key = report.commentId ?? report.postId;
    const entry = bySubject.get(key) ?? {
      postId: report.postId,
      commentId: report.commentId,
      reporters: new Set<string>(),
    };
    entry.reporters.add(report.reporterId);
    bySubject.set(key, entry);
  }
  return [...bySubject.values()].map((entry) => ({
    type: "report.resolved",
    payload: {
      communityId,
      postId: entry.postId,
      commentId: entry.commentId,
      reporterIds: [...entry.reporters],
      resolution,
      resolvedBy,
    },
  }));
}

async function announceOutcome(
  access: Access,
  resolved: readonly ResolvedReport[],
  resolution: ReportResolution,
  resolvedBy: string,
): Promise<void> {
  const events = outcomeEvents(access.community.id, resolved, resolution, resolvedBy);
  if (events.length > 0) {
    await access.store.appendEvents(newId(), events);
  }
}

export async function resolveReportsOnDelete(
  { actor, access, userId, at }: ModerationContext,
  target:
    | { readonly type: "post"; readonly postId: string }
    | {
        readonly type: "comment";
        readonly commentId: string;
        readonly commentIds: readonly string[];
      },
): Promise<void> {
  if (!can(actor, "review", "report", access.policy())) {
    return;
  }
  const { reports } = access.store;
  await reports.enableModeration();
  const resolution = { status: "content_removed" as const, resolvedBy: userId, at };
  const resolved =
    target.type === "post"
      ? await reports.resolveForPost(target.postId, resolution)
      : await reports.resolveForComments(target.commentIds, resolution);
  if (resolved.length > 0) {
    await reports.appendAudit({
      actorId: userId,
      action: "report.resolved",
      target: target.type === "post" ? target.postId : target.commentId,
      metadata: { type: target.type, resolution: "content_removed", reports: resolved.length },
    });
    await announceOutcome(access, resolved, "content_removed", userId);
  }
}

interface LocatedTarget {
  readonly target: ReportTarget;
  readonly authorId: string;
}

async function findTarget(store: PostsStore, input: ReportTargetInput): Promise<LocatedTarget> {
  const { type, id } = parseOrThrow(reportTargetInputSchema, input);
  if (type === "post") {
    const post = await store.findPost(id);
    if (!post) {
      throw new PostNotFoundError();
    }
    return { target: { kind: "post", postId: post.id }, authorId: post.authorId };
  }
  const comment = await store.findComment(id);
  if (!comment) {
    throw new CommentNotFoundError();
  }
  return {
    target: { kind: "comment", postId: comment.postId, commentId: comment.id },
    authorId: comment.authorId,
  };
}

export function createReportOperations(runtime: Runtime) {
  async function submit(
    actor: Actor,
    communityId: string,
    input: ReportInput,
    locate: (store: PostsStore) => Promise<LocatedTarget>,
  ): Promise<ReportReceipt> {
    const userId = requireUserId(actor);
    const { reason, note } = parseOrThrow(reportInputSchema, input);
    return withWriteAccess(runtime, actor, communityId, async (access) => {
      assertCan(actor, "create", "report", access.policy());
      const { target, authorId } = await locate(access.store);
      if (authorId === userId) {
        throw new ForbiddenError("create", "report");
      }
      runtime.rateLimit("report", userId);
      await access.store.reports.actAs(userId);
      const reportId = await access.store.reports.insert({
        target,
        reporterId: userId,
        reason,
        note: note ? note : null,
      });
      if (reportId) {
        await access.store.appendEvents(newId(), [
          {
            type: "report.created",
            payload: {
              communityId: access.community.id,
              reportId,
              postId: target.postId,
              commentId: target.kind === "comment" ? target.commentId : null,
              reporterId: userId,
            },
          },
        ]);
      }
      return { status: "received" };
    });
  }

  function resolveTarget(
    actor: Actor,
    communityId: string,
    input: ReportTargetInput,
    status: Exclude<ReportResolution, "content_removed">,
    beforeResolve: (authorId: string) => Promise<void> = async () => undefined,
  ): Promise<ReportResolutionResult> {
    const userId = requireUserId(actor);
    return withAccess(runtime, actor, communityId, async (access) => {
      assertCan(actor, "review", "report", access.policy());
      const { target, authorId } = await findTarget(access.store, input);
      await beforeResolve(authorId);
      const { reports } = access.store;
      await reports.enableModeration();
      const resolved = await reports.resolve(target, {
        status,
        resolvedBy: userId,
        at: runtime.now(),
      });
      if (resolved.length > 0) {
        await reports.appendAudit({
          actorId: userId,
          action: status === "dismissed" ? "report.dismissed" : "report.resolved",
          target: target.kind === "comment" ? target.commentId : target.postId,
          metadata: { type: target.kind, resolution: status, reports: resolved.length },
        });
        await announceOutcome(access, resolved, status, userId);
      }
      return { resolved: resolved.length };
    });
  }

  return {
    reportPost(
      actor: Actor,
      communityId: string,
      postId: string,
      input: ReportInput,
    ): Promise<ReportReceipt> {
      return submit(actor, communityId, input, async (store) => {
        const post = isUuid(postId) ? await store.findPost(postId) : null;
        if (!isLivePost(post)) {
          throw new PostNotFoundError();
        }
        return { target: { kind: "post", postId: post.id }, authorId: post.authorId };
      });
    },

    reportComment(
      actor: Actor,
      communityId: string,
      commentId: string,
      input: ReportInput,
    ): Promise<ReportReceipt> {
      return submit(actor, communityId, input, async (store) => {
        const comment = isUuid(commentId) ? await store.findComment(commentId) : null;
        const post = comment ? await store.findPost(comment.postId) : null;
        if (!comment || comment.deletedAt || !isLivePost(post)) {
          throw new CommentNotFoundError();
        }
        return {
          target: { kind: "comment", postId: comment.postId, commentId: comment.id },
          authorId: comment.authorId,
        };
      });
    },

    listReports(
      actor: Actor,
      communityId: string,
      input: ReportQueueInput = {},
    ): Promise<ReportQueue> {
      const { status } = parseOrThrow(reportQueueInputSchema, input);
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "review", "report", access.policy());
        const { reports } = access.store;
        await reports.enableModeration();
        const [rows, openCount] = await Promise.all([
          reports.listGroups({ open: status === "open", limit: reportQueueLimit }),
          reports.countOpenGroups(),
        ]);
        return { data: rows.map(toReportGroupView), openCount };
      });
    },

    countOpenReports(actor: Actor, communityId: string): Promise<number> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "review", "report", access.policy());
        const { reports } = access.store;
        await reports.enableModeration();
        return reports.countOpenGroups();
      });
    },

    dismissReports(
      actor: Actor,
      communityId: string,
      input: ReportTargetInput,
    ): Promise<ReportResolutionResult> {
      return resolveTarget(actor, communityId, input, "dismissed");
    },

    resolveReportsWithBan(
      actor: Actor,
      communityId: string,
      input: ReportTargetInput,
      banAuthor: (authorId: string) => Promise<void>,
    ): Promise<ReportResolutionResult> {
      return resolveTarget(actor, communityId, input, "member_banned", banAuthor);
    },
  };
}
