import type { Actor, ApiCredential } from "@cohory/authz";
import { hasAccess } from "../community-access";
import { courseAgentSettings, courseDelegations } from "@cohory/db/schema";
import { and, eq, gt, gte, inArray, isNull } from "drizzle-orm";

import { isStaffOwner, resolveDelegatedAccess } from "../access";
import { DelegationRequiredError } from "../errors";
import { licenseTerms } from "../licenses";
import type { AgentCourseAccess, AgentCourseGrant, CourseAgentTerms } from "../views";
import {
  humanAccessSince,
  isUuid,
  latestDelegation,
  loadSettings,
  scoped,
  settingsView,
  type Runtime,
} from "./context";

export interface AgentGrantCheck {
  readonly communityId: string;
  readonly courseId: string;
  readonly agentId: string;
  readonly humanUserId: string;
}

export interface AgentAccessOperations {
  agentCourseAccess(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<AgentCourseAccess>;
  assertAgentCourseAccess(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<AgentCourseGrant | null>;
  delegatedCourseIds(actor: Actor, communityId: string): Promise<ReadonlySet<string> | null>;
  agentAccessFor(check: AgentGrantCheck): Promise<AgentCourseAccess>;
  courseAgentTerms(
    communityId: string,
    courseIds: readonly string[],
  ): Promise<ReadonlyMap<string, CourseAgentTerms>>;
}

type AgentCredential = ApiCredential & { readonly type: "agent"; readonly agentId: string };

export function agentCredentialOf(actor: Actor): AgentCredential | null {
  const credential = actor.kind === "user" ? actor.credential : undefined;
  if (credential?.type !== "agent" || !credential.agentId) {
    return null;
  }
  return { ...credential, type: "agent", agentId: credential.agentId };
}

export function createAgentAccessOperations(runtime: Runtime): AgentAccessOperations {
  async function accessFor(check: AgentGrantCheck): Promise<AgentCourseAccess> {
    const { communityId, courseId, agentId, humanUserId } = check;
    if (!isUuid(communityId)) {
      return { kind: "denied", reason: "wrong_community" };
    }
    const [agent, humanAccess, since] = await Promise.all([
      runtime.agents.find(communityId, agentId),
      runtime.membershipAccess(communityId, humanUserId),
      humanAccessSince(runtime, communityId, humanUserId),
    ]);
    if (!agent || agent.ownerId !== humanUserId || agent.status !== "active") {
      return { kind: "denied", reason: "agent_inactive" };
    }
    if (isStaffOwner(humanAccess)) {
      return { kind: "staff", agentId: agent.id, humanUserId };
    }
    if (!isUuid(courseId)) {
      return { kind: "denied", reason: "no_delegation" };
    }
    const { settings, delegation } = await scoped(runtime, communityId, async (q) => ({
      settings: await loadSettings(q, courseId),
      delegation: await latestDelegation(q, courseId, agent.id),
    }));
    const resolved = resolveDelegatedAccess({
      delegation: delegation?.humanId === humanUserId ? delegation : null,
      agentStatus: agent.status,
      humanAccess,
      humanAccessSince: since,
      allowAgentAccess: settings?.allowAgentAccess ?? false,
      now: runtime.now(),
    });
    if (resolved.kind === "denied") {
      return resolved;
    }
    return {
      kind: "delegated",
      agentId: agent.id,
      humanUserId,
      delegationId: resolved.delegationId,
      expiresAt: resolved.expiresAt,
      license: licenseTerms(
        settings?.licenseId ?? "personal_agents",
        settings?.licenseText ?? null,
      ),
    };
  }

  async function agentCourseAccess(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<AgentCourseAccess> {
    const credential = agentCredentialOf(actor);
    if (!credential || actor.kind !== "user") {
      return { kind: "not_agent" };
    }
    if (credential.communityId !== communityId) {
      return { kind: "denied", reason: "wrong_community" };
    }
    return accessFor({
      communityId,
      courseId,
      agentId: credential.agentId,
      humanUserId: actor.userId,
    });
  }

  return {
    agentCourseAccess,
    agentAccessFor: accessFor,

    async courseAgentTerms(communityId, courseIds) {
      const ids = [...new Set(courseIds)].filter(isUuid);
      const terms = new Map<string, CourseAgentTerms>();
      if (ids.length === 0) {
        return terms;
      }
      const rows = await scoped(runtime, communityId, (q) =>
        q.tx
          .select()
          .from(courseAgentSettings)
          .where(q.where(courseAgentSettings, inArray(courseAgentSettings.courseId, ids))),
      );
      const byCourse = new Map(rows.map((row) => [row.courseId, row]));
      for (const id of ids) {
        const view = settingsView(id, byCourse.get(id) ?? null);
        terms.set(id, { allowAgentAccess: view.allowAgentAccess, license: view.license });
      }
      return terms;
    },

    async assertAgentCourseAccess(actor, communityId, courseId) {
      const access = await agentCourseAccess(actor, communityId, courseId);
      if (access.kind === "not_agent") {
        return null;
      }
      if (access.kind === "denied") {
        throw new DelegationRequiredError(access.reason);
      }
      return access;
    },

    async delegatedCourseIds(actor, communityId) {
      const credential = agentCredentialOf(actor);
      if (!credential || actor.kind !== "user") {
        return null;
      }
      if (credential.communityId !== communityId || !isUuid(communityId)) {
        return new Set();
      }
      const [agent, humanAccess, since] = await Promise.all([
        runtime.agents.find(communityId, credential.agentId),
        runtime.membershipAccess(communityId, actor.userId),
        humanAccessSince(runtime, communityId, actor.userId),
      ]);
      if (!agent || agent.ownerId !== actor.userId || agent.status !== "active") {
        return new Set();
      }
      if (isStaffOwner(humanAccess)) {
        return null;
      }
      if (!hasAccess(humanAccess)) {
        return new Set();
      }
      const at = runtime.now();
      const rows = await scoped(runtime, communityId, (q) =>
        q.tx
          .select({ courseId: courseDelegations.courseId })
          .from(courseDelegations)
          .innerJoin(
            courseAgentSettings,
            and(
              eq(courseAgentSettings.courseId, courseDelegations.courseId),
              eq(courseAgentSettings.communityId, courseDelegations.communityId),
            ),
          )
          .where(
            q.where(
              courseDelegations,
              eq(courseDelegations.agentId, agent.id),
              eq(courseDelegations.humanId, actor.userId),
              isNull(courseDelegations.revokedAt),
              gt(courseDelegations.expiresAt, at),
              since ? gte(courseDelegations.grantedAt, since) : undefined,
              eq(courseAgentSettings.allowAgentAccess, true),
            ),
          ),
      );
      return new Set(rows.map((row) => row.courseId));
    },
  };
}
