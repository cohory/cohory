import {
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { assertCommunityWritable } from "@cohory/communities/archive";
import { communityIdSchema, newId } from "@cohory/db";
import { noCommunityAccess } from "@cohory/entitlements/access";
import { allowAllUploads, type UploadGuard } from "@cohory/fair-use";
import { z } from "zod";
import { isStorageKey, parseStorageKey, type StorageDriver } from "@cohory/storage";

import {
  collectImages,
  collectMentions,
  collectUsernameMentions,
  ContentValidationError,
  extractPlainText,
  linkUsernameMentions,
  parseContent,
  renderContentHtml,
  replaceUnresolvedMentions,
  type ContentDocument,
} from "@cohory/content";
import { maxMentions } from "@cohory/content";
import { PostsCommunityNotFoundError, PostValidationError } from "../errors";
import type { PostEvent } from "../events";
import type {
  CommunityRecord,
  ImageRecord,
  PostsRepository,
  PostsStore,
  RenderedContent,
} from "../repository";

export type PostImageStorage = Pick<StorageDriver, "put" | "publicUrl">;

export type PostsRateLimitRule = "post" | "comment" | "reaction" | "report";

export type PostsRateLimit = (rule: PostsRateLimitRule, userId: string) => void;

export interface PostsServiceDeps {
  readonly repo: PostsRepository;
  readonly storage: PostImageStorage;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly rateLimit?: PostsRateLimit;
  readonly uploadGuard?: UploadGuard;
}

export interface Runtime {
  readonly repo: PostsRepository;
  readonly storage: PostImageStorage;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly imageUrl: (key: string) => string;
  readonly rateLimit: PostsRateLimit;
  readonly uploadGuard: UploadGuard;
}

export function createRuntime(deps: PostsServiceDeps): Runtime {
  return {
    repo: deps.repo,
    storage: deps.storage,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? newId,
    imageUrl: (key) => deps.storage.publicUrl(parseStorageKey(key)),
    rateLimit: deps.rateLimit ?? (() => undefined),
    uploadGuard: deps.uploadGuard ?? allowAllUploads,
  };
}

export interface Access {
  readonly store: PostsStore;
  readonly community: CommunityRecord;
  readonly role: CommunityRole | null;
  readonly viewerId: string | null;
  policy(ownsResource?: boolean): PolicyContext;
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

export async function withAccess<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (access: Access) => Promise<T>,
): Promise<T> {
  const parsed = communityIdSchema.safeParse(communityId);
  const community = parsed.success ? await runtime.repo.findCommunity(parsed.data) : null;
  if (!community) {
    throw new PostsCommunityNotFoundError();
  }
  return runtime.repo.inCommunity(community.id, async (store) => {
    const viewerId = actor.kind === "user" ? actor.userId : null;
    const { role, entitled } = viewerId
      ? await store.findAccess(viewerId, runtime.now())
      : noCommunityAccess;
    return fn({
      store,
      community,
      role,
      viewerId,
      policy: (ownsResource) => ({
        role,
        communityPrivacy: community.privacy,
        entitled,
        ownsResource,
      }),
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

export interface Recorded {
  readonly events: readonly PostEvent[];
  readonly outboxId: string | null;
}

export async function recordEvents<R extends { readonly events: readonly PostEvent[] }>(
  runtime: Runtime,
  access: Access,
  result: R,
): Promise<R & Recorded> {
  if (result.events.length === 0) {
    return { ...result, outboxId: null };
  }
  const outboxId = runtime.newId();
  await access.store.appendEvents(outboxId, result.events);
  return { ...result, outboxId };
}

const imageKeyFile = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(png|jpg|jpeg|webp|gif)$/i;

export function postImagePrefix(communityId: string): string {
  return `communities/${communityId}/posts/`;
}

function validateImages(doc: ContentDocument, communityId: string): ImageRecord[] {
  const prefix = postImagePrefix(communityId);
  const images = collectImages(doc);
  const keys = new Set<string>();
  for (const image of images) {
    const file = image.key.slice(prefix.length);
    if (!image.key.startsWith(prefix) || !imageKeyFile.test(file) || !isStorageKey(image.key)) {
      throw new PostValidationError([
        { path: "body", message: "Images must be uploaded to this community before posting." },
      ]);
    }
    if (keys.has(image.key)) {
      throw new PostValidationError([{ path: "body", message: "Each image can appear once." }]);
    }
    keys.add(image.key);
  }
  return images.map((image, position) => ({ ...image, position }));
}

export interface PreparedContent {
  readonly content: RenderedContent;
  readonly images: readonly ImageRecord[];
  readonly mentionedUserIds: readonly string[];
}

async function linkUsernames(access: Access, doc: ContentDocument): Promise<ContentDocument> {
  const names = collectUsernameMentions(doc).slice(0, maxMentions);
  if (names.length === 0) {
    return doc;
  }
  const members = await access.store.findActiveMembersByUsername(names);
  return linkUsernameMentions(
    doc,
    new Map(members.map((member) => [member.username.toLowerCase(), member])),
  );
}

export async function prepareContent(
  runtime: Runtime,
  access: Access,
  raw: unknown,
  options: { allowImages: boolean; authorId: string },
): Promise<PreparedContent> {
  let parsed: ContentDocument;
  try {
    parsed = parseContent(raw, { allowImages: options.allowImages });
  } catch (error) {
    if (error instanceof ContentValidationError) {
      throw new PostValidationError(error.issues);
    }
    throw error;
  }
  const images = validateImages(parsed, access.community.id);
  const linked = await linkUsernames(access, parsed);
  const mentioned = collectMentions(linked);
  const resolved =
    mentioned.length > 0 ? await access.store.filterActiveMembers(mentioned) : new Set<string>();
  const body = replaceUnresolvedMentions(linked, resolved);
  return {
    content: {
      body,
      bodyHtml: renderContentHtml(body, { imageUrl: runtime.imageUrl }),
      bodyText: extractPlainText(body),
    },
    images,
    mentionedUserIds: collectMentions(body).filter((id) => id !== options.authorId),
  };
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PostValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
