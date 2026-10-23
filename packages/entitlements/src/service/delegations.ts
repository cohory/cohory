import { assertCan, can, type Actor } from "@cohory/authz";
import type { ScopedQueries } from "@cohory/db";
import { hasAccess, noCommunityAccess } from "../community-access";
import { courseAgentSettings, courseDelegations, type CourseDelegation } from "@cohory/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

import { EntitlementsError } from "../errors";
import {
  courseAgentSettingsInputSchema,
  createDelegationInputSchema,
  delegationDays,
  parseInput,
  type CourseAgentSettingsInput,
  type CreateDelegationInput,
} from "../schemas";
import type {
  AgentLicenseListing,
  CourseAgentAccessView,
  CourseAgentSettingsView,
  DelegationView,
} from "../views";
import {
  audit,
  dayMs,
  humanAccessSince,
  delegationState,
  delegationView,
  isForeignKeyViolation,
  isUuid,
  loadSettings,
  requireHuman,
  communityAccessOf,
  roleIn,
  scoped,
  settingsView,
  type Runtime,
} from "./context";

export interface DelegationOperations {
  getCourseAgentAccess(
    actor: Actor,
    communityId: string,
    courseId: string,
  ): Promise<CourseAgentAccessView>;
  updateCourseAgentSettings(
    actor: Actor,
    communityId: string,
    courseId: string,
    input: CourseAgentSettingsInput,
  ): Promise<CourseAgentSettingsView>;
  listAgentLicenses(communityId: string): Promise<AgentLicenseListing[]>;
  listMyDelegations(
    actor: Actor,
    communityId: string,
    filter?: { readonly courseId?: string },
  ): Promise<DelegationView[]>;
  createDelegation(
    actor: Actor,
    communityId: string,
    input: CreateDelegationInput,
  ): Promise<DelegationView>;
  renewDelegation(actor: Actor, communityId: string, delegationId: string): Promise<DelegationView>;
  revokeDelegation(
    actor: Actor,
    communityId: string,
    delegationId: string,
  ): Promise<DelegationView>;
}

const listLimit = 100;

export function createDelegationOperations(runtime: Runtime): DelegationOperations {
  async function views(
    communityId: string,
    humanId: string,
    rows: readonly CourseDelegation[],
    allowed: ReadonlySet<string>,
  ): Promise<DelegationView[]> {
    if (rows.length === 0) {
      return [];
    }
    const [agents, humanAccess, since] = await Promise.all([
      runtime.agents.list(communityId, { agentIds: [...new Set(rows.map((r) => r.agentId))] }),
      runtime.membershipAccess(communityId, humanId),
      humanAccessSince(runtime, communityId, humanId),
    ]);
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const now = runtime.now();
    return rows.map((row) => {
      const agent = byId.get(row.agentId);
      return delegationView(
        row,
        agent,
        delegationState(row, {
          agent,
          humanAccess,
          humanAccessSince: since,
          allowAgentAccess: allowed.has(row.courseId),
          now,
        }),
      );
    });
  }

  async function allowedCourses(q: ScopedQueries): Promise<Set<string>> {
    const rows = await q.tx
      .select({ courseId: courseAgentSettings.courseId })
      .from(courseAgentSettings)
      .where(q.where(courseAgentSettings, eq(courseAgentSettings.allowAgentAccess, true)));
    return new Set(rows.map((row) => row.courseId));
  }

  async function loadDelegation(q: ScopedQueries, delegationId: string): Promise<CourseDelegation> {
    const [row] = isUuid(delegationId)
      ? await q.tx
          .select()
          .from(courseDelegations)
          .where(q.where(courseDelegations, eq(courseDelegations.id, delegationId)))
          .for("update")
          .limit(1)
      : [];
    if (!row) {
      throw new EntitlementsError("not_found");
    }
    return row;
  }

  async function requireDelegable(communityId: string, humanId: string, agentId: string) {
    const [humanAccess, agent] = await Promise.all([
      runtime.membershipAccess(communityId, humanId),
      runtime.agents.find(communityId, agentId),
    ]);
    if (!hasAccess(humanAccess)) {
      throw new EntitlementsError("no_access");
    }
    if (!agent || agent.ownerId !== humanId) {
      throw new EntitlementsError("agent_not_found");
    }
    if (agent.status !== "active") {
      throw new EntitlementsError("agent_inactive");
    }
    return agent;
  }

  async function single(communityId: string, humanId: string, row: CourseDelegation) {
    const allowed = await scoped(runtime, communityId, allowedCourses);
    const [view] = await views(communityId, humanId, [row], allowed);
    if (!view) {
      throw new Error("delegation view missing");
    }
    return view;
  }

  return {
    async getCourseAgentAccess(actor, communityId, courseId) {
      const viewerId = actor.kind === "user" ? actor.userId : null;
      const { role, entitled } = viewerId
        ? await communityAccessOf(runtime, communityId, viewerId)
        : noCommunityAccess;
      assertCan(actor, "read", "course", { role, entitled });
      if (!isUuid(courseId)) {
        throw new EntitlementsError("not_found");
      }
      const human = viewerId !== null && actor.kind === "user" && !actor.credential;
      const { settings, rows } = await scoped(runtime, communityId, async (q) => ({
        settings: await loadSettings(q, courseId),
        rows: human
          ? await q.tx
              .select()
              .from(courseDelegations)
              .where(
                q.where(
                  courseDelegations,
                  eq(courseDelegations.courseId, courseId),
                  eq(courseDelegations.humanId, viewerId),
                ),
              )
              .orderBy(desc(courseDelegations.grantedAt))
              .limit(20)
          : [],
      }));
      const view = settingsView(courseId, settings);
      const canManage = can(actor, "manage_agent_access", "course", { role });
      if (!human || !viewerId) {
        return { settings: view, canManage, canDelegate: false, agents: [], delegations: [] };
      }
      const [agents, humanAccess] = await Promise.all([
        runtime.agents.list(communityId, { ownerId: viewerId }),
        runtime.membershipAccess(communityId, viewerId),
      ]);
      const allowed = new Set(view.allowAgentAccess ? [courseId] : []);
      return {
        settings: view,
        canManage,
        canDelegate:
          view.allowAgentAccess &&
          hasAccess(humanAccess) &&
          can(actor, "create", "delegation", { role }),
        agents: agents
          .filter((agent) => agent.status === "active")
          .map((agent) => ({ id: agent.id, name: agent.name })),
        delegations: await views(communityId, viewerId, rows, allowed),
      };
    },

    async updateCourseAgentSettings(actor, communityId, courseId, input) {
      const { userId } = requireHuman(actor, "manage_agent_access");
      const parsed = parseInput(courseAgentSettingsInputSchema, input);
      const role = await roleIn(runtime, communityId, userId);
      assertCan(actor, "manage_agent_access", "course", { role });
      if (!isUuid(courseId)) {
        throw new EntitlementsError("not_found");
      }
      try {
        return await scoped(runtime, communityId, async (q) => {
          const at = runtime.now();
          const [row] = await q.tx
            .insert(courseAgentSettings)
            .values(
              q.values({
                courseId,
                allowAgentAccess: parsed.allowAgentAccess,
                licenseId: parsed.licenseId,
                licenseText: parsed.licenseText,
                updatedBy: userId,
                createdAt: at,
                updatedAt: at,
              }),
            )
            .onConflictDoUpdate({
              target: courseAgentSettings.courseId,
              set: {
                allowAgentAccess: parsed.allowAgentAccess,
                licenseId: parsed.licenseId,
                licenseText: parsed.licenseText,
                updatedBy: userId,
                updatedAt: at,
              },
              setWhere: eq(courseAgentSettings.communityId, q.communityId),
            })
            .returning();
          if (!row) {
            throw new EntitlementsError("not_found");
          }
          const ended = parsed.allowAgentAccess
            ? []
            : await q.tx
                .update(courseDelegations)
                .set({ revokedAt: at, revokedReason: "agent_access_off", updatedAt: at })
                .where(
                  q.where(
                    courseDelegations,
                    eq(courseDelegations.courseId, courseId),
                    isNull(courseDelegations.revokedAt),
                  ),
                )
                .returning({ id: courseDelegations.id, humanId: courseDelegations.humanId });
          await audit(runtime, q, userId, "course.agent_access_updated", courseId, {
            allowAgentAccess: row.allowAgentAccess,
            licenseId: row.licenseId,
            delegationsEnded: ended.length,
          });
          for (const delegation of ended) {
            await audit(runtime, q, userId, "delegation.ended", delegation.id, {
              courseId,
              reason: "agent_access_off",
              humanUserId: delegation.humanId,
            });
          }
          return settingsView(courseId, row);
        });
      } catch (error: unknown) {
        if (isForeignKeyViolation(error)) {
          throw new EntitlementsError("not_found");
        }
        throw error;
      }
    },

    async listAgentLicenses(communityId) {
      return scoped(runtime, communityId, async (q) => {
        const rows = await q.tx
          .select()
          .from(courseAgentSettings)
          .where(q.where(courseAgentSettings, eq(courseAgentSettings.allowAgentAccess, true)));
        return rows.map((row) => ({
          courseId: row.courseId,
          license: settingsView(row.courseId, row).license,
        }));
      });
    },

    async listMyDelegations(actor, communityId, filter = {}) {
      const { userId } = requireHuman(actor, "manage");
      const role = await roleIn(runtime, communityId, userId);
      assertCan(actor, "manage", "delegation", { role, ownsResource: true });
      const courseId = filter.courseId;
      if (courseId !== undefined && !isUuid(courseId)) {
        return [];
      }
      const { rows, allowed } = await scoped(runtime, communityId, async (q) => ({
        rows: await q.tx
          .select()
          .from(courseDelegations)
          .where(
            q.where(
              courseDelegations,
              eq(courseDelegations.humanId, userId),
              courseId ? eq(courseDelegations.courseId, courseId) : undefined,
            ),
          )
          .orderBy(desc(courseDelegations.grantedAt))
          .limit(listLimit),
        allowed: await allowedCourses(q),
      }));
      return views(communityId, userId, rows, allowed);
    },

    async createDelegation(actor, communityId, input) {
      const { userId } = requireHuman(actor, "create");
      const parsed = parseInput(createDelegationInputSchema, input);
      const role = await roleIn(runtime, communityId, userId);
      assertCan(actor, "create", "delegation", { role });
      const agent = await requireDelegable(communityId, userId, parsed.agentId);
      const since = await humanAccessSince(runtime, communityId, userId);
      const row = await scoped(runtime, communityId, async (q) => {
        const settings = await loadSettings(q, parsed.courseId);
        if (!settings?.allowAgentAccess) {
          throw new EntitlementsError("agent_access_off");
        }
        const at = runtime.now();
        const [live] = await q.tx
          .select()
          .from(courseDelegations)
          .where(
            q.where(
              courseDelegations,
              and(
                eq(courseDelegations.courseId, parsed.courseId),
                eq(courseDelegations.agentId, agent.id),
                isNull(courseDelegations.revokedAt),
              ),
            ),
          )
          .for("update")
          .limit(1);
        const stale = live !== undefined && since !== null && live.grantedAt < since;
        if (live && live.expiresAt > at && !stale) {
          throw new EntitlementsError("already_delegated");
        }
        if (live) {
          const reason = stale ? "access_ended" : "expired";
          await q.tx
            .update(courseDelegations)
            .set({ revokedAt: at, revokedReason: reason, updatedAt: at })
            .where(q.where(courseDelegations, eq(courseDelegations.id, live.id)));
          await audit(runtime, q, null, "delegation.ended", live.id, {
            courseId: live.courseId,
            agentId: live.agentId,
            reason,
          });
        }
        const [created] = await q.tx
          .insert(courseDelegations)
          .values(
            q.values({
              id: runtime.newId(),
              courseId: parsed.courseId,
              humanId: userId,
              agentId: agent.id,
              grantedAt: at,
              expiresAt: new Date(at.getTime() + delegationDays * dayMs),
              createdAt: at,
              updatedAt: at,
            }),
          )
          .returning();
        if (!created) {
          throw new Error("delegation insert returned no row");
        }
        await audit(runtime, q, userId, "delegation.created", created.id, {
          courseId: created.courseId,
          agentId: agent.id,
          licenseId: settings.licenseId,
          expiresAt: created.expiresAt.toISOString(),
        });
        return created;
      });
      return single(communityId, userId, row);
    },

    async renewDelegation(actor, communityId, delegationId) {
      const { userId } = requireHuman(actor, "manage");
      const role = await roleIn(runtime, communityId, userId);
      const current = await scoped(runtime, communityId, (q) => loadDelegation(q, delegationId));
      if (current.humanId !== userId) {
        throw new EntitlementsError("not_found");
      }
      assertCan(actor, "manage", "delegation", { role, ownsResource: true });
      if (current.revokedAt) {
        throw new EntitlementsError("cannot_renew");
      }
      await requireDelegable(communityId, userId, current.agentId);
      const since = await humanAccessSince(runtime, communityId, userId);
      if (since && current.grantedAt < since) {
        throw new EntitlementsError("cannot_renew");
      }
      const row = await scoped(runtime, communityId, async (q) => {
        const locked = await loadDelegation(q, delegationId);
        const settings = await loadSettings(q, locked.courseId);
        if (!settings?.allowAgentAccess) {
          throw new EntitlementsError("agent_access_off");
        }
        if (locked.revokedAt) {
          throw new EntitlementsError("cannot_renew");
        }
        const at = runtime.now();
        const [renewed] = await q.tx
          .update(courseDelegations)
          .set({
            expiresAt: new Date(at.getTime() + delegationDays * dayMs),
            renewedAt: at,
            expiryNoticeAt: null,
            updatedAt: at,
          })
          .where(q.where(courseDelegations, eq(courseDelegations.id, locked.id)))
          .returning();
        if (!renewed) {
          throw new EntitlementsError("not_found");
        }
        await audit(runtime, q, userId, "delegation.renewed", renewed.id, {
          courseId: renewed.courseId,
          agentId: renewed.agentId,
          expiresAt: renewed.expiresAt.toISOString(),
        });
        return renewed;
      });
      return single(communityId, userId, row);
    },

    async revokeDelegation(actor, communityId, delegationId) {
      const { userId } = requireHuman(actor, "manage");
      const role = await roleIn(runtime, communityId, userId);
      const row = await scoped(runtime, communityId, async (q) => {
        const current = await loadDelegation(q, delegationId);
        const owns = current.humanId === userId;
        if (!owns && !can(actor, "manage", "delegation", { role, ownsResource: false })) {
          throw new EntitlementsError("not_found");
        }
        assertCan(actor, "manage", "delegation", { role, ownsResource: owns });
        if (current.revokedAt) {
          return current;
        }
        const at = runtime.now();
        const [revoked] = await q.tx
          .update(courseDelegations)
          .set({ revokedAt: at, revokedReason: "revoked", revokedBy: userId, updatedAt: at })
          .where(q.where(courseDelegations, eq(courseDelegations.id, current.id)))
          .returning();
        if (!revoked) {
          throw new EntitlementsError("not_found");
        }
        await audit(runtime, q, userId, "delegation.revoked", revoked.id, {
          courseId: revoked.courseId,
          agentId: revoked.agentId,
          humanUserId: revoked.humanId,
        });
        return revoked;
      });
      return single(communityId, row.humanId, row);
    },
  };
}
