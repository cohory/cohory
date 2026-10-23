import {
  assertCan,
  can,
  ForbiddenError,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { communityIdSchema, newId } from "@cohory/db";
import { levelUnlocked, noCommunityAccess } from "@cohory/entitlements/access";
import {
  agentCredentialOf,
  defaultAgentLicenseId,
  licenseTerms,
  type EntitlementsService,
} from "@cohory/entitlements";
import { allowAllUploads, type UploadGuard } from "@cohory/fair-use";
import type { StorageDriver } from "@cohory/storage";
import { z } from "zod";

import { CourseNotFoundError, CoursesValidationError } from "../errors";
import type {
  CommunityRecord,
  CourseRecord,
  CoursesRepository,
  CoursesStore,
  Visibility,
} from "../repository";

export type AttachmentStorage = Pick<StorageDriver, "put" | "get">;

export type AgentCourseAccessCheck = Pick<
  EntitlementsService,
  "assertAgentCourseAccess" | "delegatedCourseIds" | "agentAccessFor" | "courseAgentTerms"
>;

export interface CoursesServiceDeps {
  readonly repo: CoursesRepository;
  readonly agentAccess?: AgentCourseAccessCheck;
  readonly storage: AttachmentStorage;
  readonly imageHosts?: readonly string[];
  readonly appUrl?: string;
  readonly downloadSecret?: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly uploadGuard?: UploadGuard;
}

const noAgentRestriction: AgentCourseAccessCheck = {
  assertAgentCourseAccess: () => Promise.resolve(null),
  delegatedCourseIds: () => Promise.resolve(null),
  agentAccessFor: () => Promise.resolve({ kind: "denied", reason: "no_delegation" }),
  courseAgentTerms: (_communityId, courseIds) =>
    Promise.resolve(
      new Map(
        courseIds.map((id) => [
          id,
          { allowAgentAccess: false, license: licenseTerms(defaultAgentLicenseId, null) },
        ]),
      ),
    ),
};

export interface Runtime {
  readonly repo: CoursesRepository;
  readonly agentAccess: AgentCourseAccessCheck;
  readonly storage: AttachmentStorage;
  readonly imageHosts: readonly string[];
  readonly appUrl: string;
  readonly downloadSecret: string | null;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly uploadGuard: UploadGuard;
}

export function createRuntime(deps: CoursesServiceDeps): Runtime {
  return {
    repo: deps.repo,
    agentAccess: deps.agentAccess ?? noAgentRestriction,
    storage: deps.storage,
    imageHosts: deps.imageHosts ?? [],
    appUrl: (deps.appUrl || "http://localhost:3000").replace(/\/+$/, ""),
    downloadSecret: deps.downloadSecret || null,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? newId,
    uploadGuard: deps.uploadGuard ?? allowAllUploads,
  };
}

export interface Access {
  readonly store: CoursesStore;
  readonly community: CommunityRecord;
  readonly role: CommunityRole | null;
  readonly viewerId: string | null;
  readonly manager: boolean;
  readonly visibility: Visibility;
  readonly context: PolicyContext;
  readonly agentCourseIds: ReadonlySet<string> | null;
  assertCourseReadable(courseId: string): Promise<void>;
  requiredLevelOf(course: Pick<CourseRecord, "requiredLevel">): number | null;
  isLocked(course: Pick<CourseRecord, "requiredLevel">): Promise<boolean>;
}

export async function unlockedOnly<T extends Pick<CourseRecord, "requiredLevel">>(
  access: Access,
  courses: readonly T[],
): Promise<T[]> {
  const locked = await Promise.all(courses.map((course) => access.isLocked(course)));
  return courses.filter((_, index) => !locked[index]);
}

export function assertNotDelegatedAgent(access: Access): void {
  if (access.agentCourseIds !== null) {
    throw new ForbiddenError("update_progress", "lesson");
  }
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
    throw new CoursesValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

async function readableCommunity(
  runtime: Runtime,
  actor: Actor,
  community: { readonly privacy: PolicyContext["communityPrivacy"] },
  store: CoursesStore,
  viewerId: string | null,
): Promise<{ role: CommunityRole | null; context: PolicyContext }> {
  const { role, entitled } = viewerId
    ? await store.findAccess(viewerId, runtime.now())
    : noCommunityAccess;
  const context: PolicyContext = { role, communityPrivacy: community.privacy, entitled };
  if (!can(actor, "read", "community", context)) {
    throw new CourseNotFoundError("community");
  }
  return { role, context };
}

export async function withCommunityRead<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (store: CoursesStore) => Promise<T>,
): Promise<T> {
  const parsed = communityIdSchema.safeParse(communityId);
  const community = parsed.success ? await runtime.repo.findCommunity(parsed.data) : null;
  if (!community) {
    throw new CourseNotFoundError("community");
  }
  const viewerId = actor.kind === "user" ? actor.userId : null;
  return runtime.repo.inCommunity(community.id, viewerId, async (store) => {
    await readableCommunity(runtime, actor, community, store, viewerId);
    return fn(store);
  });
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
    throw new CourseNotFoundError("community");
  }
  const viewerId = actor.kind === "user" ? actor.userId : null;
  const agentCourseIds = agentCredentialOf(actor)
    ? await runtime.agentAccess.delegatedCourseIds(actor, community.id)
    : null;
  return runtime.repo.inCommunity(community.id, viewerId, async (store) => {
    const { role, context } = await readableCommunity(runtime, actor, community, store, viewerId);
    assertCan(actor, "read", "course", context);
    const manager = can(actor, "read_drafts", "course", context);
    if (manager) {
      await store.enableManagement();
    }
    let viewerLevel: Promise<number> | undefined;
    const requiredLevelOf = (course: Pick<CourseRecord, "requiredLevel">) =>
      community.gamificationEnabled ? course.requiredLevel : null;
    return fn({
      store,
      community,
      role,
      viewerId,
      manager,
      visibility: manager ? "all" : "published",
      context,
      agentCourseIds,
      async assertCourseReadable(courseId) {
        if (agentCourseIds !== null) {
          await runtime.agentAccess.assertAgentCourseAccess(actor, community.id, courseId);
        }
      },
      requiredLevelOf,
      async isLocked(course) {
        const requiredLevel = requiredLevelOf(course);
        if (requiredLevel === null) return false;
        viewerLevel ??= viewerId ? store.findLevel(viewerId) : Promise.resolve(1);
        return !levelUnlocked({ role, level: await viewerLevel, requiredLevel });
      },
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
