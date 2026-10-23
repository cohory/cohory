import { assertCan, type Actor } from "@cohory/authz";
import { isUniqueViolation } from "@cohory/db";
import { agentSubmissions, type AgentSubmission } from "@cohory/db/schema";
import { and, count, countDistinct, desc, eq, max } from "drizzle-orm";

import { EntitlementsError } from "../errors";
import { parseInput, submitAgentResultInputSchema, type SubmitAgentResultInput } from "../schemas";
import type { SubmissionDetailView, SubmissionSummaryRow, SubmissionView } from "../views";
import { audit, isUuid, roleIn, scoped, type Runtime } from "./context";
import { agentCredentialOf, type AgentAccessOperations } from "./agent-access";

export interface SubmissionOperations {
  submitAgentResult(actor: Actor, input: SubmitAgentResultInput): Promise<SubmissionView>;
  listSubmissions(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<SubmissionDetailView[]>;
  submissionSummary(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<SubmissionSummaryRow[]>;
}

const listLimit = 100;

function toView(row: AgentSubmission, agentName: string): SubmissionView {
  return {
    id: row.id,
    courseId: row.courseId,
    lessonId: row.lessonId,
    taskId: row.taskId,
    version: row.version,
    runId: row.runId,
    label: "self_reported",
    agent: { id: row.agentId, name: agentName },
    humanId: row.humanId,
    createdAt: row.createdAt,
  };
}

export function createSubmissionOperations(
  runtime: Runtime,
  access: Pick<AgentAccessOperations, "assertAgentCourseAccess">,
): SubmissionOperations {
  async function names(communityId: string, agentIds: readonly string[]) {
    const agents = await runtime.agents.list(communityId, { agentIds: [...new Set(agentIds)] });
    return new Map(agents.map((agent) => [agent.id, agent.name]));
  }

  return {
    async submitAgentResult(actor, input) {
      const credential = agentCredentialOf(actor);
      if (!credential || actor.kind !== "user") {
        throw new EntitlementsError("agents_only");
      }
      const parsed = parseInput(submitAgentResultInputSchema, input);
      const communityId = credential.communityId;
      const role = await roleIn(runtime, communityId, actor.userId);
      assertCan(actor, "create", "submission", { role });
      const grant = await access.assertAgentCourseAccess(actor, communityId, parsed.courseId);
      if (!grant) {
        throw new EntitlementsError("agents_only");
      }
      try {
        const row = await scoped(runtime, communityId, async (q) => {
          const at = runtime.now();
          const [created] = await q.tx
            .insert(agentSubmissions)
            .values(
              q.values({
                id: runtime.newId(),
                courseId: parsed.courseId,
                lessonId: parsed.lessonId,
                taskId: parsed.taskId,
                version: parsed.version,
                agentId: grant.agentId,
                humanId: grant.humanUserId,
                delegationId: grant.kind === "delegated" ? grant.delegationId : null,
                runId: parsed.runId,
                payload: parsed.payload,
                createdAt: at,
              }),
            )
            .returning();
          if (!created) {
            throw new Error("submission insert returned no row");
          }
          await audit(runtime, q, actor.userId, "submission.created", created.id, {
            courseId: created.courseId,
            lessonId: created.lessonId,
            taskId: created.taskId,
            version: created.version,
            runId: created.runId,
            agentId: created.agentId,
            label: created.label,
          });
          return created;
        });
        const agentNames = await names(communityId, [row.agentId]);
        return toView(row, agentNames.get(row.agentId) ?? "Agent");
      } catch (error: unknown) {
        if (isUniqueViolation(error, "agent_submissions_run_unique")) {
          throw new EntitlementsError("duplicate_submission");
        }
        throw error;
      }
    },

    async listSubmissions(actor, communityId, courseId) {
      if (actor.kind !== "user") {
        throw new EntitlementsError("not_found");
      }
      const role = await roleIn(runtime, communityId, actor.userId);
      assertCan(actor, "read_own", "submission", { role });
      if (!isUuid(courseId)) {
        return [];
      }
      const credential = agentCredentialOf(actor);
      const rows = await scoped(runtime, communityId, (q) =>
        q.tx
          .select()
          .from(agentSubmissions)
          .where(
            q.where(
              agentSubmissions,
              eq(agentSubmissions.courseId, courseId),
              credential
                ? eq(agentSubmissions.agentId, credential.agentId)
                : eq(agentSubmissions.humanId, actor.userId),
            ),
          )
          .orderBy(desc(agentSubmissions.createdAt))
          .limit(listLimit),
      );
      const agentNames = await names(
        communityId,
        rows.map((row) => row.agentId),
      );
      return rows.map((row) => ({
        ...toView(row, agentNames.get(row.agentId) ?? "Removed agent"),
        payload: row.payload,
      }));
    },

    async submissionSummary(actor, communityId, courseId) {
      const userId = actor.kind === "user" ? actor.userId : null;
      const role = userId ? await roleIn(runtime, communityId, userId) : null;
      assertCan(actor, "read_summary", "submission", { role });
      if (!isUuid(courseId)) {
        return [];
      }
      const rows = await scoped(runtime, communityId, (q) =>
        q.tx
          .select({
            lessonId: agentSubmissions.lessonId,
            taskId: agentSubmissions.taskId,
            version: agentSubmissions.version,
            submissions: count(),
            agents: countDistinct(agentSubmissions.agentId),
            members: countDistinct(agentSubmissions.humanId),
            latestAt: max(agentSubmissions.createdAt),
          })
          .from(agentSubmissions)
          .where(q.where(agentSubmissions, and(eq(agentSubmissions.courseId, courseId))))
          .groupBy(agentSubmissions.lessonId, agentSubmissions.taskId, agentSubmissions.version)
          .orderBy(agentSubmissions.lessonId, agentSubmissions.taskId, agentSubmissions.version)
          .limit(500),
      );
      return rows.map((row) => ({
        lessonId: row.lessonId,
        taskId: row.taskId,
        version: row.version,
        submissions: row.submissions,
        agents: row.agents,
        members: row.members,
        latestAt: row.latestAt ?? new Date(0),
      }));
    },
  };
}
