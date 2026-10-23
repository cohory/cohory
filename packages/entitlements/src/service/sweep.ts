import { courseAgentSettings, courseDelegations } from "@cohory/db/schema";
import type { CourseDelegation } from "@cohory/db/schema";
import type { MembershipAccess } from "../community-access";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { setRlsFlag } from "@cohory/db";

import { endReasonFor, endsForGood, resolveDelegatedAccess } from "../access";
import { expiryNoticeDays } from "../schemas";
import type { SweepResult } from "../views";
import { audit, dayMs, humanAccessSince, notifySafely, scoped, type Runtime } from "./context";

interface HumanAccess {
  readonly access: MembershipAccess;
  readonly since: Date | null;
}

export interface SweepOperations {
  sweepDelegations(): Promise<SweepResult>;
}

const pageSize = 500;

interface Notice {
  readonly communityId: string;
  readonly delegation: CourseDelegation;
  readonly agentName: string;
}

export function createSweepOperations(runtime: Runtime): SweepOperations {
  async function livePage(after: string | null): Promise<CourseDelegation[]> {
    return runtime.db.transaction(async (tx) => {
      await setRlsFlag(tx, "delegation_jobs");
      return tx
        .select()
        .from(courseDelegations)
        .where(
          and(
            isNull(courseDelegations.revokedAt),
            after ? gt(courseDelegations.id, after) : undefined,
          ),
        )
        .orderBy(asc(courseDelegations.id))
        .limit(pageSize);
    });
  }

  async function sweepCommunity(
    communityId: string,
    rows: readonly CourseDelegation[],
  ): Promise<{ ended: number; notices: Notice[] }> {
    const humans = [...new Set(rows.map((row) => row.humanId))];
    const [agents, accessEntries] = await Promise.all([
      runtime.agents.list(communityId, { agentIds: [...new Set(rows.map((row) => row.agentId))] }),
      Promise.all(
        humans.map(async (userId): Promise<[string, HumanAccess]> => [
          userId,
          {
            access: await runtime.membershipAccess(communityId, userId),
            since: await humanAccessSince(runtime, communityId, userId),
          },
        ]),
      ),
    ]);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const accessByHuman = new Map(accessEntries);
    return scoped(runtime, communityId, async (q) => {
      const allowedRows = await q.tx
        .select({ courseId: courseAgentSettings.courseId })
        .from(courseAgentSettings)
        .where(
          q.where(
            courseAgentSettings,
            eq(courseAgentSettings.allowAgentAccess, true),
            inArray(courseAgentSettings.courseId, [...new Set(rows.map((row) => row.courseId))]),
          ),
        );
      const allowed = new Set(allowedRows.map((row) => row.courseId));
      const at = runtime.now();
      let ended = 0;
      const notices: Notice[] = [];
      for (const row of rows) {
        const agent = agentsById.get(row.agentId);
        const human = accessByHuman.get(row.humanId);
        if (!human) {
          continue;
        }
        const agentStatus = agent?.ownerId === row.humanId ? agent.status : null;
        const facts = {
          delegation: row,
          humanAccess: human.access,
          humanAccessSince: human.since,
          allowAgentAccess: allowed.has(row.courseId),
          now: at,
        };
        const resolved = resolveDelegatedAccess({ ...facts, agentStatus });
        const behindPause =
          resolved.kind === "denied" && !endsForGood(resolved.reason, agentStatus)
            ? resolveDelegatedAccess({ ...facts, agentStatus: "active" })
            : resolved;
        if (resolved.kind === "denied") {
          const reason = behindPause.kind === "denied" ? endReasonFor(behindPause.reason) : null;
          if (!reason || behindPause.kind !== "denied") {
            continue;
          }
          const [changed] = await q.tx
            .update(courseDelegations)
            .set({ revokedAt: at, revokedReason: reason, updatedAt: at })
            .where(
              q.where(
                courseDelegations,
                eq(courseDelegations.id, row.id),
                isNull(courseDelegations.revokedAt),
              ),
            )
            .returning({ id: courseDelegations.id });
          if (changed) {
            ended += 1;
            await audit(runtime, q, null, "delegation.ended", row.id, {
              courseId: row.courseId,
              agentId: row.agentId,
              humanUserId: row.humanId,
              reason,
            });
          }
          continue;
        }
        const dueForNotice =
          row.expiryNoticeAt === null &&
          row.expiresAt.getTime() - at.getTime() <= expiryNoticeDays * dayMs;
        if (dueForNotice) {
          const [marked] = await q.tx
            .update(courseDelegations)
            .set({ expiryNoticeAt: at, updatedAt: at })
            .where(
              q.where(
                courseDelegations,
                eq(courseDelegations.id, row.id),
                isNull(courseDelegations.expiryNoticeAt),
              ),
            )
            .returning();
          if (marked) {
            notices.push({
              communityId,
              delegation: marked,
              agentName: agent?.name ?? "Your agent",
            });
          }
        }
      }
      return { ended, notices };
    });
  }

  return {
    async sweepDelegations() {
      let ended = 0;
      let noticesSent = 0;
      let after: string | null = null;
      for (;;) {
        const page = await livePage(after);
        if (page.length === 0) {
          break;
        }
        after = page[page.length - 1]?.id ?? null;
        const byCommunity = new Map<string, CourseDelegation[]>();
        for (const row of page) {
          byCommunity.set(row.communityId, [...(byCommunity.get(row.communityId) ?? []), row]);
        }
        for (const [communityId, rows] of byCommunity) {
          const result = await sweepCommunity(communityId, rows);
          ended += result.ended;
          for (const notice of result.notices) {
            const sent = await notifySafely(runtime, {
              communityId: notice.communityId,
              userId: notice.delegation.humanId,
              actorId: notice.delegation.humanId,
              subjectType: "course_delegation",
              subjectId: notice.delegation.id,
              detail: `${notice.agentName}'s access to a course ends on ${notice.delegation.expiresAt.toISOString().slice(0, 10)}. Renew it on the course page to keep it.`,
            });
            noticesSent += sent ? 1 : 0;
          }
        }
        if (page.length < pageSize) {
          break;
        }
      }
      return { ended, noticesSent };
    },
  };
}
