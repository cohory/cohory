import { assertCan, can, ForbiddenError, type Actor } from "@cohory/authz";
import { communityIdSchema, type Community } from "@cohory/db";
import type { JoinAnswerJson, MembershipRequest } from "@cohory/db/schema";
import { assertMemberCapacity, resolveLimits } from "@cohory/fair-use";
import { userRateLimitKey } from "@cohory/rate-limit";
import { z } from "zod";

import { assertCommunityWritable } from "../archive";
import {
  CommunityNotFoundError,
  CommunityValidationError,
  InviteOnlyError,
  JoinRequestNotFoundError,
  PaymentRequiredError,
} from "../errors";
import { fairUseTier } from "../fair-use";
import { inManagedCommunity, parseInput, requireUser, type Runtime } from "./context";
import { activate } from "./membership";
import type { ManageStore } from "./repository";
import { bulkFailureCode } from "./people";
import {
  decideJoinRequestInputSchema,
  decideJoinRequestsInputSchema,
  joinRequestQueueLimit,
  requestToJoinInputSchema,
  type DecideJoinRequestInput,
  type DecideJoinRequestsInput,
  type RequestToJoinInput,
} from "./schemas";
import {
  type BulkFailure,
  type BulkResult,
  toJoinRequestQueueItem,
  toJoinRequestStatusView,
  type JoinRequestQueue,
  type JoinRequestStatusView,
  type JoinStatusView,
} from "./views";

export interface JoinDecisionResult {
  readonly requestId: string;
  readonly userId: string;
  readonly status: "approved" | "declined";
}

export function pairAnswers(community: Community, rawAnswers: readonly string[]): JoinAnswerJson[] {
  const questions = community.joinQuestions ?? [];
  const issues = questions.flatMap((question, index) =>
    question.required && !(rawAnswers[index] ?? "").trim()
      ? [{ path: `answers.${index}`, message: "Answer this question to send your request." }]
      : [],
  );
  if (rawAnswers.length > questions.length) {
    issues.push({ path: "answers", message: "There are more answers than questions." });
  }
  if (issues.length > 0) {
    throw new CommunityValidationError(issues);
  }
  return questions.map((question, index) => ({
    question: question.text,
    answer: (rawAnswers[index] ?? "").trim(),
  }));
}

export async function assertCanRequest(
  runtime: Runtime,
  store: ManageStore,
  community: Community,
  userId: string,
): Promise<void> {
  assertCommunityWritable(community);
  const existing = await store.findMember(userId);
  if (existing?.status === "banned") {
    throw new ForbiddenError("join", "membership");
  }
  const email = await store.findUserEmail(userId);
  if (email && (await store.isEmailBanned(email))) {
    throw new ForbiddenError("join", "membership");
  }
  if (community.currency !== null) {
    throw new PaymentRequiredError();
  }
  const limits = await resolveLimits(runtime.fairUse(), ["members"], () =>
    fairUseTier((since) => store.hasPaidTransactionSince(since), runtime.now()),
  );
  if (limits.members !== null) {
    assertMemberCapacity(limits, await store.countActiveMembers());
  }
}

export async function openJoinRequest(
  store: ManageStore,
  userId: string,
  answers: readonly JoinAnswerJson[],
): Promise<MembershipRequest> {
  const inserted = await store.insertJoinRequest(userId, answers);
  if (inserted) {
    await store.appendAudit({
      actorId: userId,
      action: "join_request.created",
      target: inserted.id,
    });
    await store.appendMembershipEvents([
      {
        type: "join_request.created",
        payload: { communityId: inserted.communityId, requestId: inserted.id, userId },
      },
    ]);
    return inserted;
  }
  const pending = await store.findLatestJoinRequest(userId);
  if (pending?.status !== "pending") {
    throw new JoinRequestNotFoundError();
  }
  return pending;
}

async function inRequesterScope<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (scope: { userId: string; community: Community; store: ManageStore }) => Promise<T>,
): Promise<T> {
  const user = requireUser(actor);
  const parsedId = communityIdSchema.safeParse(communityId);
  if (!parsedId.success) {
    throw new CommunityNotFoundError();
  }
  return runtime.repo.inCommunity(parsedId.data, { userId: user.userId }, async (store) => {
    const community = await store.findCommunity();
    if (!community || community.deletedAt) {
      throw new CommunityNotFoundError();
    }
    return fn({ userId: user.userId, community, store });
  });
}

export function joiningOperations(runtime: Runtime) {
  async function decide(
    actor: Actor,
    communityId: string,
    requestId: string,
    status: "approved" | "declined",
    input: DecideJoinRequestInput,
  ): Promise<JoinDecisionResult> {
    const { note } = parseInput(decideJoinRequestInputSchema, input);
    return inManagedCommunity(runtime, actor, communityId, async (managed) => {
      assertCan(actor, "approve", "membership", managed.context);
      assertCommunityWritable(managed.community);
      if (!z.uuid().safeParse(requestId).success) {
        throw new JoinRequestNotFoundError();
      }
      await managed.store.enableManagement();
      const request = await managed.store.findJoinRequest(requestId);
      if (request?.status !== "pending") {
        throw new JoinRequestNotFoundError();
      }
      const now = runtime.now();
      if (status === "approved") {
        await assertCanRequest(runtime, managed.store, managed.community, request.userId);
        const existing = await managed.store.findMember(request.userId);
        if (existing?.status !== "active") {
          await activate(managed.store, request.userId, existing, now);
        }
      }
      const decided = await managed.store.decideJoinRequest(request.id, {
        status,
        note,
        decidedBy: managed.user.userId,
        decidedAt: now,
      });
      if (!decided) {
        throw new JoinRequestNotFoundError();
      }
      await managed.store.appendAudit({
        actorId: managed.user.userId,
        action: status === "approved" ? "join_request.approved" : "join_request.declined",
        target: request.userId,
        metadata: { requestId: request.id, note: note !== null },
      });
      await managed.store.appendMembershipEvents([
        {
          type: "join_request.decided",
          payload: {
            communityId: managed.community.id,
            requestId: request.id,
            userId: request.userId,
            decidedBy: managed.user.userId,
            status,
          },
        },
      ]);
      return { requestId: request.id, userId: request.userId, status };
    });
  }

  return {
    async requestToJoin(
      actor: Actor,
      communityId: string,
      input: RequestToJoinInput = {},
    ): Promise<JoinRequestStatusView> {
      const { answers } = parseInput(requestToJoinInputSchema, input);
      runtime.rateLimit("joinRequest", userRateLimitKey(requireUser(actor).userId));
      return inRequesterScope(runtime, actor, communityId, async ({ userId, community, store }) => {
        assertCan(actor, "join", "membership", { role: null });
        const existing = await store.findMember(userId);
        if (existing?.status === "active") {
          throw new ForbiddenError("join", "membership");
        }
        await assertCanRequest(runtime, store, community, userId);
        if (community.joinMode === "invite") {
          throw new InviteOnlyError();
        }
        if (community.joinMode !== "approval") {
          throw new ForbiddenError("join", "membership");
        }
        return toJoinRequestStatusView(
          await openJoinRequest(store, userId, pairAnswers(community, answers)),
        );
      });
    },

    getJoinStatus(actor: Actor, communityId: string): Promise<JoinStatusView> {
      return inRequesterScope(runtime, actor, communityId, async ({ userId, store }) => {
        const [membership, request] = await Promise.all([
          store.findMember(userId),
          store.findLatestJoinRequest(userId),
        ]);
        return {
          membershipStatus: membership?.status ?? null,
          request: request ? toJoinRequestStatusView(request) : null,
        };
      });
    },

    listJoinRequests(actor: Actor, communityId: string): Promise<JoinRequestQueue> {
      return inManagedCommunity(runtime, actor, communityId, async ({ context, store }) => {
        assertCan(actor, "approve", "membership", context);
        await store.enableManagement();
        const showEmail = can(actor, "read_email", "membership", context);
        const [rows, pendingCount] = await Promise.all([
          store.listPendingJoinRequests(joinRequestQueueLimit),
          store.countPendingJoinRequests(),
        ]);
        return { data: rows.map((row) => toJoinRequestQueueItem(row, showEmail)), pendingCount };
      });
    },

    countJoinRequests(actor: Actor, communityId: string): Promise<number> {
      return inManagedCommunity(runtime, actor, communityId, async ({ context, store }) => {
        assertCan(actor, "approve", "membership", context);
        await store.enableManagement();
        return store.countPendingJoinRequests();
      });
    },

    approveJoinRequest(
      actor: Actor,
      communityId: string,
      requestId: string,
      input: DecideJoinRequestInput = {},
    ): Promise<JoinDecisionResult> {
      return decide(actor, communityId, requestId, "approved", input);
    },

    declineJoinRequest(
      actor: Actor,
      communityId: string,
      requestId: string,
      input: DecideJoinRequestInput = {},
    ): Promise<JoinDecisionResult> {
      return decide(actor, communityId, requestId, "declined", input);
    },

    async decideJoinRequests(
      actor: Actor,
      communityId: string,
      input: DecideJoinRequestsInput,
    ): Promise<BulkResult> {
      const parsed = parseInput(decideJoinRequestsInputSchema, input);
      await inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "approve", "membership", managed.context);
        assertCommunityWritable(managed.community);
      });
      const status = parsed.decision === "approve" ? "approved" : "declined";
      const done: string[] = [];
      const failed: BulkFailure[] = [];
      for (const requestId of new Set(parsed.requestIds)) {
        try {
          await decide(actor, communityId, requestId, status, {});
          done.push(requestId);
        } catch (error) {
          const code = bulkFailureCode(error);
          if (code === null) {
            throw error;
          }
          failed.push({ id: requestId, code });
        }
      }
      return { done, failed };
    },
  };
}
