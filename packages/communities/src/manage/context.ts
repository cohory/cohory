import { randomBytes } from "node:crypto";

import {
  can,
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { communityIdSchema, type Community } from "@cohory/db";
import { getFairUseConfig, type FairUseConfig } from "@cohory/fair-use";
import {
  createSharpProcessor,
  parseStorageKey,
  type ImageProcessor,
  type StorageDriver,
} from "@cohory/storage";
import type { z } from "zod";

import { getRateLimiter } from "@cohory/rate-limit";

import { CommunityNotFoundError, CommunityValidationError } from "../errors";
import { paymentsMemberAccess, type MemberAccessPort } from "./member-access";
import { paymentsPaidExit, type PaidExitPort } from "./paid-exit";
import type { ManageRepository, ManageStore } from "./repository";
import { createVideoThumbnailResolver, type VideoThumbnailResolver } from "./video-thumbnail";

export type UserActor = Extract<Actor, { kind: "user" }>;

export type BrandingStorage = Pick<StorageDriver, "put" | "delete" | "publicUrl" | "usedBytes">;

export interface ManageServiceDeps {
  readonly repo: ManageRepository;
  readonly storage: BrandingStorage;
  readonly fairUse?: FairUseConfig;
  readonly now?: () => Date;
  readonly newToken?: () => string;
  readonly rateLimit?: (rule: "joinRequest", key: string) => void;
  readonly videoThumbnail?: VideoThumbnailResolver;
  readonly paidExit?: PaidExitPort;
  readonly memberAccess?: MemberAccessPort;
  readonly processImage?: ImageProcessor | null;
}

export interface Runtime {
  readonly repo: ManageRepository;
  readonly storage: BrandingStorage;
  readonly fairUse: () => FairUseConfig;
  readonly now: () => Date;
  readonly newToken: () => string;
  readonly brandingUrl: (key: string) => string;
  readonly rateLimit: (rule: "joinRequest", key: string) => void;
  readonly videoThumbnail: VideoThumbnailResolver;
  readonly paidExit: PaidExitPort;
  readonly memberAccess: MemberAccessPort;
  readonly processImage: ImageProcessor | null;
}

export function createRuntime(deps: ManageServiceDeps): Runtime {
  return {
    repo: deps.repo,
    storage: deps.storage,
    fairUse: () => deps.fairUse ?? getFairUseConfig(),
    now: deps.now ?? (() => new Date()),
    newToken: deps.newToken ?? (() => randomBytes(32).toString("base64url")),
    brandingUrl: (key) => deps.storage.publicUrl(parseStorageKey(key)),
    rateLimit: deps.rateLimit ?? ((rule, key) => getRateLimiter().consume(rule, key)),
    videoThumbnail: deps.videoThumbnail ?? createVideoThumbnailResolver(),
    paidExit: deps.paidExit ?? paymentsPaidExit,
    memberAccess: deps.memberAccess ?? paymentsMemberAccess,
    processImage: deps.processImage === undefined ? createSharpProcessor() : deps.processImage,
  };
}

export function requireUser(actor: Actor): UserActor {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor;
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CommunityValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}

export interface Managed {
  readonly user: UserActor;
  readonly community: Community;
  readonly role: CommunityRole | null;
  readonly context: PolicyContext;
  readonly store: ManageStore;
}

export async function inManagedCommunity<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (managed: Managed) => Promise<T>,
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
    const member = await store.findMember(user.userId);
    const role = member?.status === "active" ? member.role : null;
    const context: PolicyContext = { role, communityPrivacy: community.privacy };
    if (!can(actor, "read", "community", context)) {
      throw new CommunityNotFoundError();
    }
    return fn({ user, community, role, context, store });
  });
}
