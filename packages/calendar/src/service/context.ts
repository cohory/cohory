import {
  assertCan,
  can,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { communityIdSchema, newId } from "@cohory/db";
import { noCommunityAccess } from "@cohory/entitlements/access";
import { z } from "zod";

import { CalendarNotFoundError, CalendarValidationError } from "../errors";
import type { CalendarNoticeInput } from "../notices";
import type { CalendarRepository, CalendarStore, CommunityRecord } from "../repository";
import type { CalendarQueue, TimeChangeJobInput } from "../time-change";

export type CalendarRateLimit = (rule: "rsvp", userId: string) => void;

export type CalendarQueueError = (
  error: unknown,
  payload: TimeChangeJobInput | CalendarNoticeInput,
) => void;

export interface CalendarServiceDeps {
  readonly repo: CalendarRepository;
  readonly appUrl?: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly rateLimit?: CalendarRateLimit;
  readonly queue?: CalendarQueue | null;
  readonly onQueueError?: CalendarQueueError;
}

export interface Runtime {
  readonly repo: CalendarRepository;
  readonly appUrl: string | null;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly rateLimit: CalendarRateLimit;
  readonly queue: CalendarQueue | null;
  readonly onQueueError: CalendarQueueError;
}

export function createRuntime(deps: CalendarServiceDeps): Runtime {
  return {
    repo: deps.repo,
    appUrl: deps.appUrl ? deps.appUrl.replace(/\/+$/, "") : null,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? newId,
    rateLimit: deps.rateLimit ?? (() => undefined),
    queue: deps.queue ?? null,
    onQueueError: deps.onQueueError ?? (() => undefined),
  };
}

export interface Access {
  readonly store: CalendarStore;
  readonly community: CommunityRecord;
  readonly role: CommunityRole | null;
  readonly viewerId: string | null;
  readonly manager: boolean;
  readonly detailsVisible: boolean;
  readonly context: PolicyContext;
}

const uuidSchema = z.uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor.userId;
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CalendarValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function calendarUrl(runtime: Runtime, community: CommunityRecord): string | null {
  return runtime.appUrl ? `${runtime.appUrl}/c/${community.slug}/calendar` : null;
}

export async function withAccess<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (access: Access) => Promise<T>,
): Promise<T> {
  const parsed = communityIdSchema.safeParse(communityId);
  const community = parsed.success ? await runtime.repo.findCommunity(parsed.data) : null;
  if (!community) {
    throw new CalendarNotFoundError("community");
  }
  const viewerId = actor.kind === "user" ? actor.userId : null;
  return runtime.repo.inCommunity(community.id, viewerId, async (store) => {
    const { role, entitled } = viewerId
      ? await store.findAccess(viewerId, runtime.now())
      : noCommunityAccess;
    const context: PolicyContext = { role, communityPrivacy: community.privacy, entitled };
    if (!can(actor, "read", "community", context)) {
      throw new CalendarNotFoundError("community");
    }
    assertCan(actor, "read_title", "event", context);
    const manager = can(actor, "update", "event", context);
    if (manager) {
      await store.enableManagement();
    }
    return fn({
      store,
      community,
      role,
      viewerId,
      manager,
      detailsVisible: can(actor, "read", "event", context),
      context,
    });
  });
}

export function withWriteAccess<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (access: Access) => Promise<T>,
): Promise<T> {
  return withAccess(runtime, actor, communityId, async (access) => {
    assertCommunityWritable(access.community);
    return fn(access);
  });
}
