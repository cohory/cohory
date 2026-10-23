import { assertCan, can, ForbiddenError, UnauthenticatedError, type Actor } from "@cohory/authz";
import {
  creatorExitActions,
  creatorExitReasons,
  creatorFeedbackCommentMaxLength,
  creatorFeedbackRetentionMonths,
  creatorMoments,
  type CreatorExitAction,
  type CreatorMoment,
} from "@cohory/db/schema";
import type { EmailOutbox } from "@cohory/email";
import { z } from "zod";

import { NotificationValidationError } from "../errors";
import { easeScale, easierPrompt, exitActionLabels, exitReasonLabels, momentCopy } from "./copy";
import type { CreatorFeedbackStore } from "./store";

const day = 24 * 60 * 60 * 1000;

export const momentQuestionCapDays = 30;
export const momentQuestionMaxAgeDays = 90;

const comment = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || null : value),
  z
    .string()
    .max(
      creatorFeedbackCommentMaxLength,
      `Keep it under ${creatorFeedbackCommentMaxLength} characters.`,
    )
    .nullable()
    .default(null),
);

const respondSchema = z
  .strictObject({
    communityId: z.uuid(),
    moment: z.enum(creatorMoments),
    outcome: z.enum(["answered", "dismissed", "snoozed"]),
    score: z.number().int().min(1).max(5).nullable().default(null),
    comment,
    optOut: z.boolean().default(false),
  })
  .refine((input) => input.outcome !== "answered" || input.score !== null, {
    path: ["score"],
    message: "Choose a number from 1 to 5.",
  });

const exitSchema = z
  .strictObject({
    communityId: z.uuid().nullable(),
    action: z.enum(creatorExitActions),
    reason: z.enum(creatorExitReasons).nullable().default(null),
    comment,
  })
  .refine((input) => (input.action === "delete_account") === (input.communityId === null), {
    path: ["communityId"],
    message: "Account deletion has no community; every other action has one.",
  });

export type MomentResponseInput = z.input<typeof respondSchema>;
export type ExitReasonInput = z.input<typeof exitSchema>;

export type RecordMomentOutcome =
  "recorded" | "already_recorded" | "not_first" | "no_owner" | "opted_out" | "unavailable";

export interface MomentQuestion {
  readonly communityId: string;
  readonly moment: CreatorMoment;
  readonly question: string;
  readonly low: string;
  readonly high: string;
  readonly followUp: string;
  readonly commentMaxLength: number;
}

export interface CreatorFeedbackPreferences {
  readonly available: boolean;
  readonly optedOut: boolean;
}

export interface CreatorFeedbackServiceDeps {
  readonly store: CreatorFeedbackStore;
  readonly outbox: Pick<EmailOutbox, "send">;
  readonly contactEmail: string | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly isFirstMoment?: (communityId: string, moment: CreatorMoment) => Promise<boolean>;
  readonly now?: () => Date;
}

export interface CreatorFeedbackService {
  recordMoment(input: {
    readonly communityId: string;
    readonly moment: CreatorMoment;
  }): Promise<RecordMomentOutcome>;
  nextQuestion(actor: Actor, communityId: string): Promise<MomentQuestion | null>;
  respond(actor: Actor, input: MomentResponseInput): Promise<boolean>;
  recordExit(actor: Actor, input: ExitReasonInput): Promise<boolean>;
  preferences(actor: Actor): Promise<CreatorFeedbackPreferences>;
  setOptOut(actor: Actor, optedOut: boolean): Promise<void>;
  removeExpired(): Promise<number>;
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new NotificationValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}

function signedIn(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor.userId;
}

export function createCreatorFeedbackService(
  deps: CreatorFeedbackServiceDeps,
): CreatorFeedbackService {
  const now = deps.now ?? (() => new Date());
  const enabled = deps.edition === "cloud";
  const { store } = deps;

  async function ownerSlug(actor: Actor, communityId: string): Promise<string> {
    const userId = signedIn(actor);
    const standing = await store.standingIn(userId, communityId);
    assertCan(actor, "answer", "creator_feedback", { role: standing?.role ?? null });
    if (!standing) {
      throw new ForbiddenError("answer", "creator_feedback");
    }
    return standing.slug;
  }

  async function email(data: {
    kind: "moment" | "exit";
    topic: string;
    question: string | null;
    score: number | null;
    reason: string | null;
    comment: string | null;
    userId: string;
    communitySlug: string | null;
    at: Date;
  }): Promise<void> {
    if (!deps.contactEmail) {
      return;
    }
    const { at, ...rest } = data;
    await deps.outbox.send({
      template: "creator-feedback",
      to: deps.contactEmail,
      data: {
        ...rest,
        edition: deps.edition,
        instanceUrl: deps.instanceUrl,
        sentAt: at.toISOString(),
      },
    });
  }

  return {
    async recordMoment({ communityId, moment }) {
      if (!enabled) {
        return "unavailable";
      }
      if (!deps.isFirstMoment) {
        throw new Error("recordMoment needs isFirstMoment");
      }
      if (!(await deps.isFirstMoment(communityId, moment))) {
        return "not_first";
      }
      const owner = await store.ownerOf(communityId);
      if (!owner) {
        return "no_owner";
      }
      if (await store.optedOutAt(owner.userId)) {
        return "opted_out";
      }
      const inserted = await store.insertPendingMoment({
        userId: owner.userId,
        communityId,
        moment,
        at: now(),
      });
      return inserted ? "recorded" : "already_recorded";
    },

    async nextQuestion(actor, communityId) {
      if (!enabled || actor.kind !== "user" || actor.credential) {
        return null;
      }
      const standing = await store.standingIn(actor.userId, communityId);
      if (!standing || !can(actor, "answer", "creator_feedback", { role: standing.role })) {
        return null;
      }
      if (await store.optedOutAt(actor.userId)) {
        return null;
      }
      const at = now().getTime();
      const last = await store.lastMomentResponseAt(actor.userId);
      if (last && at - last.getTime() < momentQuestionCapDays * day) {
        return null;
      }
      const pending = await store.oldestPendingMoment(
        actor.userId,
        new Date(at - momentQuestionMaxAgeDays * day),
      );
      if (pending?.communityId !== communityId) {
        return null;
      }
      return {
        communityId,
        moment: pending.moment,
        question: momentCopy[pending.moment].question,
        low: easeScale.low,
        high: easeScale.high,
        followUp: easierPrompt,
        commentMaxLength: creatorFeedbackCommentMaxLength,
      };
    },

    async respond(actor, raw) {
      if (!enabled) {
        return false;
      }
      const input = parse(respondSchema, raw);
      const slug = await ownerSlug(actor, input.communityId);
      const userId = signedIn(actor);
      const at = now();
      const answered = input.outcome === "answered";
      const updated = await store.respondToMoment({
        userId,
        communityId: input.communityId,
        moment: input.moment,
        status: input.outcome,
        score: answered ? input.score : null,
        comment: answered ? input.comment : null,
        at,
      });
      if (input.optOut) {
        await store.setOptedOut(userId, at);
      }
      if (updated && answered) {
        await email({
          kind: "moment",
          topic: momentCopy[input.moment].label,
          question: momentCopy[input.moment].question,
          score: input.score,
          reason: null,
          comment: input.comment,
          userId,
          communitySlug: slug,
          at,
        });
      }
      return updated;
    },

    async recordExit(actor, raw) {
      if (!enabled) {
        return false;
      }
      const input = parse(exitSchema, raw);
      const userId = signedIn(actor);
      let slug: string | null = null;
      if (input.communityId === null) {
        assertCan(actor, "update_own", "account");
      } else {
        slug = await ownerSlug(actor, input.communityId);
      }
      if (input.reason === null && input.comment === null) {
        return false;
      }
      const at = now();
      const action: CreatorExitAction = input.action;
      await store.insertExit({
        userId,
        communityId: input.communityId,
        action,
        reason: input.reason,
        comment: input.comment,
        at,
      });
      await email({
        kind: "exit",
        topic: exitActionLabels[action],
        question: null,
        score: null,
        reason: input.reason ? exitReasonLabels[input.reason] : null,
        comment: input.comment,
        userId,
        communitySlug: slug,
        at,
      });
      return true;
    },

    async preferences(actor) {
      const userId = signedIn(actor);
      if (!enabled) {
        return { available: false, optedOut: false };
      }
      assertCan(actor, "update_own", "account");
      return { available: true, optedOut: (await store.optedOutAt(userId)) !== null };
    },

    async setOptOut(actor, optedOut) {
      const userId = signedIn(actor);
      if (!enabled) {
        return;
      }
      assertCan(actor, "update_own", "account");
      await store.setOptedOut(userId, optedOut ? now() : null);
    },

    removeExpired() {
      const cutoff = now();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - creatorFeedbackRetentionMonths);
      return store.removeCreatedBefore(cutoff);
    },
  };
}
