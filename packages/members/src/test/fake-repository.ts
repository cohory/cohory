import type { CommunityRole } from "@cohory/authz";
import { newId, parseCommunityId, type CommunityId } from "@cohory/db";
import { communityAccessFrom } from "@cohory/entitlements/access";

import type {
  MemberProfileRow,
  MembersCommunity,
  MembersRepository,
  RecentActivity,
  ViewerMembership,
} from "../repository";

interface FakeMember {
  membershipId: string;
  role: CommunityRole;
  status: ViewerMembership["status"];
  joinedAt: Date;
  bio: string | null;
  points: number;
  level: number;
}

interface FakeUser {
  name: string;
  username: string | null;
}

export interface FakeMembersRepository extends MembersRepository {
  addCommunity(options?: Partial<Omit<MembersCommunity, "id">> & { id?: string }): CommunityId;
  addMember(
    communityId: string,
    options?: {
      name?: string;
      role?: CommunityRole;
      status?: ViewerMembership["status"];
      points?: number;
      level?: number;
      joinedAt?: Date;
    },
  ): string;
  addUser(name?: string): string;
  bioOf(communityId: string, userId: string): string | null;
  usernameOf(userId: string): string | null;
}

export function createFakeMembersRepository(): FakeMembersRepository {
  const communities = new Map<string, MembersCommunity>();
  const members = new Map<string, Map<string, FakeMember>>();
  const users = new Map<string, FakeUser>();
  let clock = Date.UTC(2026, 0, 1);

  function row(communityId: string, userId: string): MemberProfileRow | null {
    const member = members.get(communityId)?.get(userId);
    const user = users.get(userId);
    if (!member || !user || member.status !== "active") {
      return null;
    }
    return {
      membershipId: member.membershipId,
      userId,
      name: user.name,
      image: null,
      username: user.username,
      role: member.role,
      joinedAt: member.joinedAt,
      points: member.points,
      level: member.level,
      bio: member.bio,
    };
  }

  const empty: RecentActivity = { posts: [], comments: [] };

  return {
    addCommunity(options = {}) {
      const id = parseCommunityId(options.id ?? newId());
      communities.set(id, {
        id,
        privacy: options.privacy ?? "private",
        gamificationEnabled: options.gamificationEnabled ?? true,
        levelNames: options.levelNames ?? [],
      });
      members.set(id, new Map());
      return id;
    },
    addUser(name = "Person") {
      const id = newId();
      users.set(id, { name, username: null });
      return id;
    },
    addMember(communityId, options = {}) {
      const userId = newId();
      users.set(userId, { name: options.name ?? "Person", username: null });
      members.get(communityId)?.set(userId, {
        membershipId: newId(),
        role: options.role ?? "member",
        status: options.status ?? "active",
        joinedAt: options.joinedAt ?? new Date((clock += 1000)),
        bio: null,
        points: options.points ?? 0,
        level: options.level ?? 1,
      });
      return userId;
    },
    bioOf(communityId, userId) {
      return members.get(communityId)?.get(userId)?.bio ?? null;
    },
    usernameOf(userId) {
      return users.get(userId)?.username ?? null;
    },
    async findCommunity(id) {
      return communities.get(id) ?? null;
    },
    async findAccess(communityId, userId) {
      const member = members.get(communityId)?.get(userId);
      return communityAccessFrom({
        membership: member ? { role: member.role, status: member.status } : null,
        subscription: null,
        comp: null,
        paidPlanActive: false,
        now: new Date(),
      });
    },
    async searchMembers(communityId, search) {
      const rows = [...(members.get(communityId)?.keys() ?? [])]
        .map((userId) => row(communityId, userId))
        .filter((r): r is MemberProfileRow => r !== null)
        .filter((r) => {
          const q = search.query?.toLowerCase();
          const matches = !q || r.name.toLowerCase().startsWith(q) || !!r.username?.startsWith(q);
          return matches && (search.level === null || r.level === search.level);
        })
        .sort(
          (a, b) =>
            b.joinedAt.getTime() - a.joinedAt.getTime() ||
            b.membershipId.localeCompare(a.membershipId),
        )
        .filter(
          (r) =>
            !search.after ||
            r.joinedAt.getTime() < search.after.joinedAt.getTime() ||
            (r.joinedAt.getTime() === search.after.joinedAt.getTime() &&
              r.membershipId < search.after.membershipId),
        );
      return rows.slice(0, search.limit);
    },
    async fullTextSearch(communityId, query, limit) {
      const terms = query.split(" & ").map((term) => term.replace(":*", ""));
      return [...(members.get(communityId)?.keys() ?? [])]
        .map((userId) => row(communityId, userId))
        .filter((r): r is MemberProfileRow => r !== null)
        .filter((r) => {
          const text = `${r.name} ${r.username ?? ""} ${r.bio ?? ""}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        })
        .slice(0, limit)
        .map((r) => ({
          userId: r.userId,
          name: r.name,
          username: r.username,
          image: r.image,
          bioHeadline: r.bio,
          rank: 1,
        }));
    },
    async findActiveMember(communityId, userId) {
      return row(communityId, userId);
    },
    async recentActivity() {
      return empty;
    },
    async findLevels(communityId, userIds) {
      return userIds.flatMap((userId) => {
        const member = members.get(communityId)?.get(userId);
        return member && member.status === "active" ? [{ userId, level: member.level }] : [];
      });
    },
    async updateBio(communityId, userId, bio) {
      const member = members.get(communityId)?.get(userId);
      if (member) {
        member.bio = bio;
      }
    },
    async findUsername(userId) {
      return users.get(userId)?.username ?? null;
    },
    async setUsername(userId, username) {
      const taken = [...users.entries()].some(
        ([id, user]) => id !== userId && user.username === username,
      );
      if (taken) {
        return "taken";
      }
      const user = users.get(userId);
      if (user) {
        user.username = username;
      }
      return "updated";
    },
  };
}
