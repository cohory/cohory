import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { setRlsFlag } from "../tenancy/session";

import type { Database } from "../client";
import { createCommunity, getCommunityBySlug } from "../repositories/communities";
import { insertMembershipIfAbsent } from "../repositories/memberships";
import { isUniqueViolation } from "../repositories/unique-violation";
import {
  accounts,
  inviteLinks,
  users,
  type CommunityPrivacy,
  type JoinAnswerJson,
  type JoinMode,
} from "../schema";
import { communitySlugSchema, type CommunitySlug } from "../slug";
import { runInCommunity, withCommunity, type CommunityId } from "../tenancy/scope";

interface DevUser {
  readonly email: string;
  readonly name: string;
  readonly username: string;
}

export type DevPersonRole = "admin" | "member" | "none";

export interface DevPerson extends DevUser {
  readonly role: DevPersonRole;
  readonly joinedDaysAgo?: number;
  readonly joinAnswers?: readonly JoinAnswerJson[];
}

export interface DevSeedConfig {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly username: string;
  readonly communitySlug: CommunitySlug;
  readonly communityName: string;
  readonly communityDescription: string;
  readonly privacy: CommunityPrivacy;
  readonly joinMode: JoinMode;
  readonly inviteToken: string;
  readonly people: readonly DevPerson[];
}

export const devAdmin = {
  email: "admin@cohory.local",
  name: "Alex Morgan",
  username: "alex",
  role: "admin",
  joinedDaysAgo: 40,
} as const satisfies DevPerson;

export const devMember = {
  email: "member@cohory.local",
  name: "Jamie Lee",
  username: "jamie",
  role: "member",
  joinedDaysAgo: 21,
} as const satisfies DevPerson;

export const devUser = {
  email: "user@cohory.local",
  name: "Taylor Kim",
  username: "taylor",
  role: "none",
} as const satisfies DevPerson;

export const devJoinQuestions = [
  { text: "What community are you building, and who is it for?", required: true },
  {
    text: "How many members do you have today: none yet, under 100, 100 to 1,000, or more than 1,000?",
    required: true,
  },
  { text: "A link to your community or website, if you have one", required: false },
] as const;

function answers(building: string, size: string, link = ""): readonly JoinAnswerJson[] {
  const [first, second, third] = devJoinQuestions;
  return [
    { question: first.text, answer: building },
    { question: second.text, answer: size },
    { question: third.text, answer: link },
  ];
}

export const devCreators = [
  {
    email: "maya@cohory.local",
    name: "Maya Chen",
    username: "maya",
    role: "member",
    joinedDaysAgo: 18,
    joinAnswers: answers(
      "Clay at Home, a ceramics course for people who throw pots in a garage or a kitchen.",
      "100 to 1,000",
      "https://clayathome.example.com",
    ),
  },
  {
    email: "diego@cohory.local",
    name: "Diego Ramos",
    username: "diego",
    role: "member",
    joinedDaysAgo: 12,
    joinAnswers: answers(
      "Trail Runners Lab, training plans and weekly check ins for trail runners.",
      "Under 100",
    ),
  },
  {
    email: "priya@cohory.local",
    name: "Priya Nair",
    username: "priya",
    role: "member",
    joinedDaysAgo: 7,
    joinAnswers: answers(
      "Design Critique Circle, a paid mentorship for junior product designers. Moving from Skool.",
      "More than 1,000",
      "https://critique.example.com",
    ),
  },
  {
    email: "sam@cohory.local",
    name: "Sam Okafor",
    username: "sam",
    role: "member",
    joinedDaysAgo: 2,
    joinAnswers: answers("Tiny Games Guild, for people making their first small game.", "None yet"),
  },
] as const satisfies readonly DevPerson[];

export const devSeed = {
  email: "owner@cohory.local",
  password: "cohory-dev-password",
  name: "Riza",
  username: "riza",
  communitySlug: communitySlugSchema.parse("cohory-creators"),
  communityName: "Cohory Creators",
  communityDescription:
    "Where creators who run their community on Cohory share feedback, ideas, and wins with the Cohory team.",
  privacy: "private",
  joinMode: "approval",
  inviteToken: "cohory-creators-invite-link-for-local-tests",
  people: [devAdmin, devMember, devUser, ...devCreators],
} as const satisfies DevSeedConfig;

export const devPaidSeed = {
  communitySlug: communitySlugSchema.parse("cohory-pro"),
  communityName: "Cohory Pro",
  communityDescription:
    "A private paid community for trying memberships, checkout, and the billing portal on a local stack.",
  inviteToken: "cohory-pro-invite-link-for-local-paid-tests",
  planName: "Cohory Pro membership",
  currency: "usd",
  monthlyPriceMinor: 1900,
  annualPriceMinor: 19000,
} as const;

interface DevCommunity {
  readonly slug: CommunitySlug;
  readonly name: string;
  readonly description: string;
  readonly privacy: CommunityPrivacy;
  readonly joinMode: JoinMode;
}

export interface SeedResult {
  userCreated: boolean;
  communityCreated: boolean;
  membershipCreated: boolean;
  usersCreated: number;
  membersCreated: number;
  inviteCreated: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;

function joinedAt(person: DevPerson, now: Date): Date {
  return new Date(now.getTime() - (person.joinedDaysAgo ?? 0) * dayMs);
}

async function findDevUser(db: Database, email: string) {
  const [existing] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return existing ?? null;
}

async function ensureDevUser(
  db: Database,
  seed: DevUser,
  password: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findDevUser(db, seed.email);
  if (existing) {
    if (existing.username === null) {
      await db.update(users).set({ username: seed.username }).where(eq(users.id, existing.id));
    }
    return { id: existing.id, created: false };
  }

  const passwordHash = await hashPassword(password);
  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: seed.name, email: seed.email, username: seed.username, emailVerified: true })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) {
      return null;
    }
    await tx.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash,
    });
    return user.id;
  });
  if (created) {
    return { id: created, created: true };
  }

  const raced = await findDevUser(db, seed.email);
  if (!raced) {
    throw new Error("dev user conflict without an existing row");
  }
  return { id: raced.id, created: false };
}

async function ensureDevCommunity(db: Database, seed: DevCommunity) {
  const existing = await getCommunityBySlug(db, seed.slug);
  if (existing) {
    return { community: existing, created: false };
  }
  try {
    const community = await createCommunity(db, seed);
    return { community, created: true };
  } catch (error) {
    if (!isUniqueViolation(error, "communities_slug_unique")) {
      throw error;
    }
  }
  const raced = await getCommunityBySlug(db, seed.slug);
  if (!raced) {
    throw new Error("dev community conflict without an existing row");
  }
  return { community: raced, created: false };
}

async function ensureDevInvite(
  db: Database,
  communityId: CommunityId,
  token: string,
  createdBy: string,
): Promise<boolean> {
  return runInCommunity(withCommunity(db, communityId), async ({ tx, values }) => {
    await setRlsFlag(tx, "community_manager");
    const inserted = await tx
      .insert(inviteLinks)
      .values(values({ token, createdBy }))
      .onConflictDoNothing({ target: inviteLinks.token })
      .returning({ id: inviteLinks.id });
    return inserted.length > 0;
  });
}

export async function seedDevDataWith(
  db: Database,
  seed: DevSeedConfig,
  now = new Date(),
): Promise<SeedResult> {
  const user = await ensureDevUser(db, seed, seed.password);
  const { community, created: communityCreated } = await ensureDevCommunity(db, {
    slug: seed.communitySlug,
    name: seed.communityName,
    description: seed.communityDescription,
    privacy: seed.privacy,
    joinMode: seed.joinMode,
  });
  const scope = withCommunity(db, community.id);

  const owner = await insertMembershipIfAbsent(scope, {
    userId: user.id,
    role: "owner",
    status: "active",
    joinedAt: new Date(now.getTime() - 60 * dayMs),
  });

  let usersCreated = 0;
  let membersCreated = 0;
  for (const person of seed.people) {
    const account = await ensureDevUser(db, person, seed.password);
    if (account.created) {
      usersCreated += 1;
    }
    if (person.role === "none") {
      continue;
    }
    const membership = await insertMembershipIfAbsent(scope, {
      userId: account.id,
      role: person.role,
      status: "active",
      joinedAt: joinedAt(person, now),
      ...(person.joinAnswers ? { joinAnswers: [...person.joinAnswers] } : {}),
    });
    if (membership.created) {
      membersCreated += 1;
    }
  }

  const inviteCreated = await ensureDevInvite(db, community.id, seed.inviteToken, user.id);

  return {
    userCreated: user.created,
    communityCreated,
    membershipCreated: owner.created,
    usersCreated,
    membersCreated,
    inviteCreated,
  };
}

export interface PaidCommunitySeedResult {
  readonly paidCommunityCreated: boolean;
  readonly paidMembersCreated: number;
  readonly paidInviteCreated: boolean;
}

async function seedDevPaidCommunity(
  db: Database,
  ownerId: string,
  now: Date,
): Promise<PaidCommunitySeedResult> {
  const { community, created } = await ensureDevCommunity(db, {
    slug: devPaidSeed.communitySlug,
    name: devPaidSeed.communityName,
    description: devPaidSeed.communityDescription,
    privacy: "private",
    joinMode: "approval",
  });
  const scope = withCommunity(db, community.id);
  await insertMembershipIfAbsent(scope, {
    userId: ownerId,
    role: "owner",
    status: "active",
    joinedAt: new Date(now.getTime() - 30 * dayMs),
  });
  const member = await findDevUser(db, devMember.email);
  if (!member) {
    throw new Error("dev member missing after the base seed");
  }
  const membership = await insertMembershipIfAbsent(scope, {
    userId: member.id,
    role: "member",
    status: "active",
    joinedAt: new Date(now.getTime() - 14 * dayMs),
  });
  const paidInviteCreated = await ensureDevInvite(
    db,
    community.id,
    devPaidSeed.inviteToken,
    ownerId,
  );
  return {
    paidCommunityCreated: created,
    paidMembersCreated: membership.created ? 1 : 0,
    paidInviteCreated,
  };
}

export async function seedDevData(
  db: Database,
  now = new Date(),
): Promise<SeedResult & PaidCommunitySeedResult> {
  const result = await seedDevDataWith(db, devSeed, now);
  const owner = await findDevUser(db, devSeed.email);
  if (!owner) {
    throw new Error("dev owner missing after the base seed");
  }
  return { ...result, ...(await seedDevPaidCommunity(db, owner.id, now)) };
}
