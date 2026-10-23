import { assertCan, can, ForbiddenError, type Actor, type PolicyContext } from "@cohory/authz";
import type { MemberRole, MemberStatus } from "@cohory/db/schema";
import { LimitReachedError } from "@cohory/fair-use";
import { z } from "zod";

import { assertCommunityWritable } from "../archive";
import { CommunitiesError, MembershipNotFoundError } from "../errors";
import { inManagedCommunity, parseInput, type Managed, type Runtime } from "./context";
import { decodeManageCursor, encodeManageCursor } from "./cursor";
import { accessUserFilter } from "./member-access";
import type { MemberCriteria, MemberRecord, UserIdFilter } from "./repository";
import {
  bulkMemberActionInputSchema,
  changeRoleInputSchema,
  listManageMembersInputSchema,
  managePageSize,
  type AssignableRole,
  type BulkMemberActionInput,
  type ListManageMembersInput,
} from "./schemas";
import {
  toManageMember,
  type BulkFailure,
  type BulkResult,
  type ManageMemberDetail,
  type ManageMemberPage,
} from "./views";

const dayMs = 24 * 60 * 60 * 1000;

export function memberCriteria(
  input: {
    readonly query?: string;
    readonly role?: MemberRole;
    readonly status?: MemberStatus;
    readonly inactiveDays?: number;
    readonly neverSignedIn?: boolean;
  },
  searchEmail: boolean,
  now: Date,
  defaultStatus: MemberStatus | null = "active",
  userIds: UserIdFilter | null = null,
): MemberCriteria {
  const inactive = input.inactiveDays !== undefined;
  return {
    query: input.query ? input.query : null,
    searchEmail,
    role: input.role ?? null,
    status: inactive ? "active" : (input.status ?? defaultStatus),
    inactiveBefore: inactive ? new Date(now.getTime() - (input.inactiveDays ?? 0) * dayMs) : null,
    neverSignedIn: input.neverSignedIn ?? false,
    userIds,
  };
}

export function bulkFailureCode(error: unknown): string | null {
  if (error instanceof CommunitiesError || error instanceof ForbiddenError) {
    return error.code;
  }
  if (error instanceof LimitReachedError) {
    return error.code;
  }
  return null;
}

export interface MemberChange {
  readonly userId: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
}

function targetContext(managed: Managed, userId: string, target: MemberRecord): PolicyContext {
  return {
    ...managed.context,
    target: { role: target.role, isSelf: userId === managed.user.userId },
  };
}

async function loadTarget(
  managed: Managed,
  userId: string,
  allowed: readonly MemberStatus[],
): Promise<MemberRecord> {
  const target = await managed.store.findMember(userId);
  if (!target || !allowed.includes(target.status)) {
    throw new MembershipNotFoundError();
  }
  return target;
}

export function peopleOperations(runtime: Runtime) {
  const operations = {
    async listMembersForManage(
      actor: Actor,
      communityId: string,
      input: ListManageMembersInput = {},
    ): Promise<ManageMemberPage> {
      const parsed = parseInput(listManageMembersInputSchema, input);
      const filterAccess =
        parsed.access === undefined
          ? null
          : await runtime.memberAccess.list(actor, communityId, null);
      const listed = await inManagedCommunity(
        runtime,
        actor,
        communityId,
        async ({ context, store }) => {
          assertCan(actor, "manage", "membership", context);
          const showEmail = can(actor, "read_email", "membership", context);
          const limit = parsed.limit ?? managePageSize;
          const userIds =
            parsed.access !== undefined && filterAccess
              ? accessUserFilter(parsed.access, filterAccess)
              : null;
          const rows = await store.listMembers({
            ...memberCriteria(parsed, showEmail, runtime.now(), "active", userIds),
            cursor: parsed.cursor ? decodeManageCursor(parsed.cursor) : null,
            limit: limit + 1,
          });
          return {
            rows,
            limit,
            showEmail,
            seesAccess: can(actor, "read", "payment", context),
          };
        },
      );
      const page = listed.rows.slice(0, listed.limit);
      const last = page.at(-1);
      const access = listed.seesAccess
        ? (filterAccess ??
          (await runtime.memberAccess.list(
            actor,
            communityId,
            page.map((row) => row.userId),
          )))
        : null;
      return {
        data: page.map((row) => toManageMember(row, listed.showEmail, access)),
        nextCursor:
          listed.rows.length > listed.limit && last
            ? encodeManageCursor({ sortAt: last.sortAt, membershipId: last.membershipId })
            : null,
      };
    },

    async getMemberForManage(
      actor: Actor,
      communityId: string,
      userId: string,
    ): Promise<ManageMemberDetail> {
      if (!z.uuid().safeParse(userId).success) {
        throw new MembershipNotFoundError();
      }
      const found = await inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "membership", managed.context);
        const showEmail = can(actor, "read_email", "membership", managed.context);
        const [row] = await managed.store.listMembers({
          ...memberCriteria({}, showEmail, runtime.now(), null, {
            mode: "include",
            ids: [userId],
          }),
          cursor: null,
          limit: 1,
        });
        if (!row) {
          throw new MembershipNotFoundError();
        }
        await managed.store.enableManagement();
        const request = await managed.store.findLatestJoinRequest(userId);
        const paidAnswers = request ? [] : await managed.store.findPaidJoinAnswers(userId);
        return {
          row,
          showEmail,
          request,
          paidAnswers,
          seesAccess: can(actor, "read", "payment", managed.context),
        };
      });
      const access = found.seesAccess
        ? await runtime.memberAccess.list(actor, communityId, [userId])
        : null;
      return {
        member: toManageMember(found.row, found.showEmail, access),
        answers: found.request?.answers ?? found.paidAnswers,
        requestedAt: found.request?.createdAt ?? null,
      };
    },

    changeRole(
      actor: Actor,
      communityId: string,
      userId: string,
      role: AssignableRole,
    ): Promise<MemberChange> {
      const parsed = parseInput(changeRoleInputSchema, { role });
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "membership", managed.context);
        assertCommunityWritable(managed.community);
        const target = await loadTarget(managed, userId, ["active"]);
        assertCan(actor, "change_role", "membership", targetContext(managed, userId, target));
        if (parsed.role === "admin") {
          assertCan(actor, "assign_admin", "membership", managed.context);
        }
        if (target.role !== parsed.role) {
          await managed.store.setRole(userId, parsed.role);
          await managed.store.appendAudit({
            actorId: managed.user.userId,
            action: "member.role_changed",
            target: userId,
            metadata: { from: target.role, to: parsed.role },
          });
        }
        return { userId, role: parsed.role, status: target.status };
      });
    },

    async removeMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange> {
      const change = await inManagedCommunity<MemberChange>(
        runtime,
        actor,
        communityId,
        async (managed) => {
          assertCan(actor, "manage", "membership", managed.context);
          assertCommunityWritable(managed.community);
          const target = await loadTarget(managed, userId, ["active", "pending"]);
          assertCan(actor, "remove", "membership", targetContext(managed, userId, target));
          await managed.store.setStatus(userId, "removed", {
            role: "member",
            removedByStaff: true,
          });
          await managed.store.appendAudit({
            actorId: managed.user.userId,
            action: "member.removed",
            target: userId,
            metadata: { role: target.role },
          });
          return { userId, role: "member", status: "removed" };
        },
      );
      await runtime.paidExit.endMemberBilling({ communityId, userId, kind: "removed" });
      return change;
    },

    async banMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange> {
      const change = await inManagedCommunity<MemberChange>(
        runtime,
        actor,
        communityId,
        async (managed) => {
          assertCan(actor, "manage", "membership", managed.context);
          assertCommunityWritable(managed.community);
          const target = await loadTarget(managed, userId, [
            "active",
            "pending",
            "removed",
            "banned",
          ]);
          assertCan(actor, "ban", "membership", targetContext(managed, userId, target));
          if (target.status !== "banned") {
            const email = await managed.store.findUserEmail(userId);
            await managed.store.setStatus(userId, "banned", { bannedEmail: email, role: "member" });
            await managed.store.appendAudit({
              actorId: managed.user.userId,
              action: "member.banned",
              target: userId,
              metadata: { role: target.role, previousStatus: target.status },
            });
          }
          return { userId, role: "member", status: "banned" };
        },
      );
      await runtime.paidExit.endMemberBilling({ communityId, userId, kind: "banned" });
      return change;
    },

    async applyMemberAction(
      actor: Actor,
      communityId: string,
      input: BulkMemberActionInput,
    ): Promise<BulkResult> {
      const parsed = parseInput(bulkMemberActionInputSchema, input);
      await inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "membership", managed.context);
        assertCommunityWritable(managed.community);
      });
      const run = parsed.action === "remove" ? operations.removeMember : operations.banMember;
      const done: string[] = [];
      const failed: BulkFailure[] = [];
      for (const userId of new Set(parsed.userIds)) {
        try {
          await run(actor, communityId, userId);
          done.push(userId);
        } catch (error) {
          const code = bulkFailureCode(error);
          if (code === null) {
            throw error;
          }
          failed.push({ id: userId, code });
        }
      }
      return { done, failed };
    },

    unbanMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange> {
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "manage", "membership", managed.context);
        assertCommunityWritable(managed.community);
        const target = await loadTarget(managed, userId, ["banned"]);
        assertCan(actor, "ban", "membership", targetContext(managed, userId, target));
        await managed.store.setStatus(userId, "removed");
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "member.unbanned",
          target: userId,
        });
        return { userId, role: target.role, status: "removed" };
      });
    },
  };
  return operations;
}
