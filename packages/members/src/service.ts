import {
  assertCan,
  can,
  UnauthenticatedError,
  everyScope,
  type Actor,
  type CommunityRole,
  type PolicyContext,
  type ScopeCheck,
} from "@cohory/authz";
import {
  communityIdSchema,
  getDb,
  prefixTsQuery,
  splitHighlights,
  type ExcerptSegment,
} from "@cohory/db";
import { noCommunityAccess } from "@cohory/entitlements/access";
import { levelName } from "@cohory/gamification";
import { z } from "zod";

import { decodeMemberCursor, encodeMemberCursor } from "./cursor";
import {
  MemberNotFoundError,
  MembersValidationError,
  UsernameReservedError,
  UsernameTakenError,
} from "./errors";
import { createPostgresMembersRepository } from "./postgres-repository";
import type { MemberRow, MembersCommunity, MembersRepository } from "./repository";
import {
  membersPageSize,
  recentActivityLimit,
  reservedUsernames,
  searchMembersInputSchema,
  setUsernameInputSchema,
  updateProfileInputSchema,
  type SearchMembersInput,
  type SetUsernameInput,
  type UpdateProfileInput,
} from "./schemas";
import type { GamificationSettings, MemberPage, MemberProfile, MemberSummary } from "./views";

export interface MemberSearchHit {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly image: string | null;
  readonly bioExcerpt: readonly ExcerptSegment[];
}

export interface MembersService {
  searchMembers(actor: Actor, communityId: string, input: SearchMembersInput): Promise<MemberPage>;
  findMembers(
    actor: Actor,
    communityId: string,
    query: string,
    limit: number,
  ): Promise<MemberSearchHit[]>;
  getMemberProfile(
    actor: Actor,
    communityId: string,
    userId: string,
    allows?: ScopeCheck,
  ): Promise<MemberProfile>;
  updateMyProfile(
    actor: Actor,
    communityId: string,
    input: UpdateProfileInput,
  ): Promise<MemberProfile>;
  getGamificationSettings(actor: Actor, communityId: string): Promise<GamificationSettings>;
  getMemberLevels(
    actor: Actor,
    communityId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  getMyUsername(actor: Actor): Promise<string | null>;
  setUsername(actor: Actor, input: SetUsernameInput): Promise<{ readonly username: string }>;
}

interface Access {
  readonly community: MembersCommunity;
  readonly role: CommunityRole | null;
  readonly context: PolicyContext;
}

const uuid = z.uuid();

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new MembersValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function requireUser(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor;
}

function toSummary(row: MemberRow, community: MembersCommunity): MemberSummary {
  const on = community.gamificationEnabled;
  return {
    userId: row.userId,
    name: row.name,
    image: row.image,
    username: row.username,
    role: row.role,
    joinedAt: row.joinedAt,
    points: on ? row.points : null,
    level: on ? row.level : null,
    levelName: on ? levelName(row.level, community.levelNames) : null,
    bio: row.bio,
  };
}

export function createMembersService(repo: MembersRepository): MembersService {
  async function access(actor: Actor, communityId: string): Promise<Access> {
    const parsed = communityIdSchema.safeParse(communityId);
    const community = parsed.success ? await repo.findCommunity(parsed.data) : null;
    if (!community) {
      throw new MemberNotFoundError();
    }
    const { role, entitled } =
      actor.kind === "user" ? await repo.findAccess(community.id, actor.userId) : noCommunityAccess;
    const context = { role, communityPrivacy: community.privacy, entitled };
    if (!can(actor, "read", "community", context)) {
      throw new MemberNotFoundError();
    }
    return { community, role, context };
  }

  async function profile(community: MembersCommunity, userId: string): Promise<MemberProfile> {
    const row = uuid.safeParse(userId).success
      ? await repo.findActiveMember(community.id, userId)
      : null;
    if (!row) {
      throw new MemberNotFoundError();
    }
    return {
      ...toSummary(row, community),
      recentActivity: await repo.recentActivity(community.id, row.userId, recentActivityLimit),
    };
  }

  return {
    async searchMembers(actor, communityId, input) {
      const { community, context } = await access(actor, communityId);
      assertCan(actor, "list", "membership", context);
      const {
        query,
        level,
        cursor,
        limit = membersPageSize,
      } = parse(searchMembersInputSchema, input);
      const rows = await repo.searchMembers(community.id, {
        query: query ? query : null,
        level: community.gamificationEnabled ? (level ?? null) : null,
        after: cursor ? decodeMemberCursor(cursor) : null,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        data: page.map((row) => toSummary(row, community)),
        nextCursor:
          rows.length > limit && last
            ? encodeMemberCursor({ joinedAt: last.joinedAt, membershipId: last.membershipId })
            : null,
      };
    },

    async findMembers(actor, communityId, query, limit) {
      const { community, context } = await access(actor, communityId);
      assertCan(actor, "list", "membership", context);
      const tsQuery = prefixTsQuery(query);
      if (!tsQuery) {
        return [];
      }
      const rows = await repo.fullTextSearch(community.id, tsQuery, limit);
      return rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        username: row.username,
        image: row.image,
        bioExcerpt: row.bioHeadline ? splitHighlights(row.bioHeadline) : [],
      }));
    },

    async getMemberProfile(actor, communityId, userId, allows = everyScope) {
      const { community, context } = await access(actor, communityId);
      assertCan(actor, "read_profile", "membership", context);
      const found = await profile(community, userId);
      return {
        ...found,
        recentActivity: {
          posts: allows("posts:read") ? found.recentActivity.posts : [],
          comments: allows("comments:read") ? found.recentActivity.comments : [],
        },
      };
    },

    async updateMyProfile(actor, communityId, input) {
      const me = requireUser(actor);
      const { community, context } = await access(actor, communityId);
      assertCan(actor, "update_own_profile", "membership", context);
      const { bio } = parse(updateProfileInputSchema, input);
      await repo.updateBio(community.id, me.userId, bio);
      return profile(community, me.userId);
    },

    async getGamificationSettings(actor, communityId) {
      const { community } = await access(actor, communityId);
      return { enabled: community.gamificationEnabled, levelNames: community.levelNames };
    },

    async getMemberLevels(actor, communityId, userIds) {
      const { community } = await access(actor, communityId);
      const ids = [...new Set(userIds)].filter((id) => uuid.safeParse(id).success);
      if (!community.gamificationEnabled || ids.length === 0) {
        return new Map();
      }
      const rows = await repo.findLevels(community.id, ids);
      return new Map(rows.map((row) => [row.userId, row.level]));
    },

    async getMyUsername(actor) {
      return repo.findUsername(requireUser(actor).userId);
    },

    async setUsername(actor, input) {
      const me = requireUser(actor);
      assertCan(actor, "update_own", "account");
      const { username } = parse(setUsernameInputSchema, input);
      if (reservedUsernames.has(username)) {
        throw new UsernameReservedError(username);
      }
      if ((await repo.setUsername(me.userId, username)) === "taken") {
        throw new UsernameTakenError(username);
      }
      return { username };
    },
  };
}

let defaultService: MembersService | undefined;

export function getMembersService(): MembersService {
  defaultService ??= createMembersService(createPostgresMembersRepository(getDb()));
  return defaultService;
}
