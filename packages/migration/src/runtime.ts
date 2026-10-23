import {
  appendAuditEntry,
  getCommunityById,
  hasPaidTransactionSince,
  parseCommunityId,
  type Community,
  type Database,
} from "@cohory/db";
import { courses, events, memberships, posts, users, type MemberRole } from "@cohory/db/schema";
import {
  communityEmailBrand,
  type CommunityBrandInput,
  type FirstContact,
  type FirstContactOrigin,
  type Mailer,
  type OptOutLinker,
  type SuppressionList,
} from "@cohory/email";
import {
  paidTierWindowStart,
  resolveLimits,
  tierFromPaidActivity,
  type FairUseConfig,
  type FairUseLimits,
} from "@cohory/fair-use";
import { parseStorageKey, type StorageDriver } from "@cohory/storage";
import { count, eq, ne } from "drizzle-orm";

import type { MigrationConfig } from "./config";
import { MigrationError, MigrationNotFoundError } from "./errors";
import type { MigrationQueue } from "./jobs";
import { inMigrationScope } from "./scope";
import { createJobStore, type JobStore } from "./store";

export type ArchiveStorage = Pick<StorageDriver, "put" | "get" | "delete">;
export type ContentStorage = Pick<StorageDriver, "put" | "get" | "publicUrl">;

export interface MigrationDeps {
  readonly db: Database;
  readonly archiveStorage: ArchiveStorage;
  readonly contentStorage: ContentStorage;
  readonly queue: MigrationQueue;
  readonly config: MigrationConfig;
  readonly fairUse: FairUseConfig;
  readonly mailer?: Mailer;
  readonly optOut?: OptOutLinker;
  readonly suppression?: MigrationSuppression;
  readonly now?: () => Date;
}

export type MigrationSuppression = Pick<SuppressionList, "isSuppressed">;

export interface Runtime {
  readonly db: Database;
  readonly jobs: JobStore;
  readonly archiveStorage: ArchiveStorage;
  readonly contentStorage: ContentStorage;
  readonly queue: MigrationQueue;
  readonly config: MigrationConfig;
  readonly fairUse: FairUseConfig;
  readonly mailer: Mailer | undefined;
  readonly optOut: OptOutLinker | undefined;
  readonly suppression: MigrationSuppression | undefined;
  readonly now: () => Date;
}

export function createRuntime(deps: MigrationDeps): Runtime {
  return {
    db: deps.db,
    jobs: createJobStore(deps.db),
    archiveStorage: deps.archiveStorage,
    contentStorage: deps.contentStorage,
    queue: deps.queue,
    config: deps.config,
    fairUse: deps.fairUse,
    mailer: deps.mailer,
    optOut: deps.optOut,
    suppression: deps.suppression,
    now: deps.now ?? (() => new Date()),
  };
}

export function archiveKey(communityId: string, folder: "exports" | "imports", jobId: string) {
  return parseStorageKey(`migration/${communityId}/${folder}/${jobId}.zip`);
}

export async function loadCommunity(runtime: Runtime, communityId: string): Promise<Community> {
  const parsed = parseCommunityId(communityId);
  const community = await getCommunityById(runtime.db, parsed);
  if (!community || community.deletedAt) {
    throw new MigrationNotFoundError("community");
  }
  return community;
}

export function emailBrandOf(runtime: Runtime, community: Community): CommunityBrandInput {
  return communityEmailBrand(community.appearance, () => runtime.contentStorage);
}

export interface FirstContactMail {
  readonly firstContact: FirstContact | undefined;
  readonly envelope: { readonly communityId: string; readonly headers?: Record<string, string> };
}

export function firstContactMail(
  runtime: Runtime,
  input: { to: string; communityId: string; inviterName: string; origin: FirstContactOrigin },
): FirstContactMail {
  const { to, communityId, inviterName, origin } = input;
  if (!runtime.optOut) {
    return { firstContact: undefined, envelope: { communityId } };
  }
  const links = runtime.optOut({ to, communityId });
  return {
    firstContact: { inviterName, origin, optOutUrl: links.url },
    envelope: { communityId, headers: links.headers },
  };
}

export async function userName(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await inMigrationScope(runtime.db, communityId, ({ tx }) =>
    tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
  );
  return row?.name ?? null;
}

export async function roleOf(
  runtime: Runtime,
  communityId: string,
  userId: string,
): Promise<MemberRole | null> {
  return inMigrationScope(runtime.db, communityId, async ({ tx, where }) => {
    const [row] = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(where(memberships, eq(memberships.userId, userId)))
      .limit(1);
    return row?.status === "active" ? row.role : null;
  });
}

export function memberLimits(runtime: Runtime, community: Community): Promise<FairUseLimits> {
  return resolveLimits(runtime.fairUse, ["members"], async () =>
    tierFromPaidActivity(
      await inMigrationScope(runtime.db, community.id, (queries) =>
        hasPaidTransactionSince(queries, paidTierWindowStart(runtime.now())),
      ),
    ),
  );
}

export async function activeMemberCount(runtime: Runtime, communityId: string): Promise<number> {
  return inMigrationScope(runtime.db, communityId, async ({ tx, where }) => {
    const [row] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(where(memberships, eq(memberships.status, "active")));
    return row?.value ?? 0;
  });
}

export async function assertFreshCommunity(
  runtime: Runtime,
  communityId: string,
  ownerUserId: string,
): Promise<void> {
  const used = await inMigrationScope(runtime.db, communityId, async ({ tx, where }) => {
    const [postCount] = await tx.select({ value: count() }).from(posts).where(where(posts));
    const [courseCount] = await tx.select({ value: count() }).from(courses).where(where(courses));
    const [eventCount] = await tx.select({ value: count() }).from(events).where(where(events));
    const [memberCount] = await tx
      .select({ value: count() })
      .from(memberships)
      .where(where(memberships, ne(memberships.userId, ownerUserId)));
    return (
      (postCount?.value ?? 0) +
      (courseCount?.value ?? 0) +
      (eventCount?.value ?? 0) +
      (memberCount?.value ?? 0)
    );
  });
  if (used > 0) {
    throw new MigrationError(
      "community_not_empty",
      "Import into a new, empty community. This one already has members, posts, courses, or events.",
    );
  }
}

export async function audit(
  runtime: Runtime,
  communityId: string,
  entry: { actorId: string | null; action: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await inMigrationScope(runtime.db, communityId, (queries) =>
    appendAuditEntry(queries, { ...entry, target: communityId }),
  );
}

export async function readStoredFile(
  storage: Pick<StorageDriver, "get">,
  key: string,
): Promise<Uint8Array | null> {
  const object = await storage.get(parseStorageKey(key));
  if (!object) {
    return null;
  }
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}
