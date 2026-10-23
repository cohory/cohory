import { createAgentsService } from "@cohory/agents";
import { ForbiddenError, type Actor } from "@cohory/authz";
import { getMembership, newId, withCommunity, type CommunityId } from "@cohory/db";
import { agentIdentities } from "@cohory/db/schema";
import {
  createEntitlementsService,
  DelegationRequiredError,
  type MembershipAccessReader,
} from "@cohory/entitlements";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();

const membershipAccess: MembershipAccessReader = async (communityId, userId) => {
  const membership = await getMembership(withCommunity(db, communityId as CommunityId), userId);
  if (membership?.status !== "active") {
    return { level: "not_member" };
  }
  return membership.role === "member"
    ? { level: "member", source: "membership" }
    : { level: "staff", role: membership.role };
};

const agents = createAgentsService({ db });
const entitlements = createEntitlementsService({
  db,
  membershipAccess,
  agents: {
    find: (communityId, agentId) => agents.findAgent(communityId, agentId),
    list: (communityId, filter) => agents.agentSummaries(communityId, filter),
  },
});
const courses = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage: memoryStorage(),
  agentAccess: entitlements,
});

afterAll(async () => {
  await close();
});

function agentOf(communityId: CommunityId, ownerId: string, agentId: string): Actor {
  return {
    kind: "user",
    userId: ownerId,
    platformAdmin: false,
    credential: {
      type: "agent",
      tokenId: newId(),
      agentId,
      communityId,
      scopes: ["courses:read"],
      via: "api",
    },
  };
}

async function setup() {
  const communityId = await insertCommunity(db);
  const admin = await insertMember(db, communityId, "admin");
  const member = await insertMember(db, communityId, "member");
  const course = await courses.createCourse(user(admin), communityId, { title: "Agents 101" });
  const other = await courses.createCourse(user(admin), communityId, { title: "Pottery" });
  const module = await courses.createModule(user(admin), communityId, course.slug, {
    title: "Basics",
  });
  const lesson = await courses.createLesson(user(admin), communityId, course.slug, module.id, {
    title: "Welcome",
    bodyMarkdown: "# Welcome",
  });
  const otherModule = await courses.createModule(user(admin), communityId, other.slug, {
    title: "Basics",
  });
  await courses.createLesson(user(admin), communityId, other.slug, otherModule.id, {
    title: "Wedging",
  });
  await courses.publishLesson(user(admin), communityId, lesson.id);
  await courses.publishCourse(user(admin), communityId, course.slug);
  await courses.publishCourse(user(admin), communityId, other.slug, { publishDraftLessons: true });
  const agentId = newId();
  await db.insert(agentIdentities).values({
    id: agentId,
    communityId,
    ownerId: member,
    name: "Reader",
    scopes: ["courses:read"],
    createdBy: member,
  });
  await entitlements.updateCourseAgentSettings(user(admin), communityId, course.id, {
    allowAgentAccess: true,
    licenseId: "personal_agents",
  });
  return { communityId, admin, member, course, other, lesson, agentId };
}

describe("course reads by agents", () => {
  it("needs a delegation from the member, per course, and stops after revocation", async () => {
    const w = await setup();
    const agent = agentOf(w.communityId, w.member, w.agentId);
    await expect(courses.getCourse(agent, w.communityId, w.course.slug)).rejects.toBeInstanceOf(
      DelegationRequiredError,
    );
    expect(await courses.listCourses(agent, w.communityId)).toEqual([]);

    const delegation = await entitlements.createDelegation(user(w.member), w.communityId, {
      courseId: w.course.id,
      agentId: w.agentId,
    });
    const detail = await courses.getCourse(agent, w.communityId, w.course.slug);
    expect(detail.id).toBe(w.course.id);
    const lesson = await courses.getLesson(agent, w.communityId, w.course.slug, w.lesson.slug);
    expect(lesson.title).toBe("Welcome");
    expect((await courses.listCourses(agent, w.communityId)).map((c) => c.id)).toEqual([
      w.course.id,
    ]);
    await expect(courses.getCourse(agent, w.communityId, w.other.slug)).rejects.toBeInstanceOf(
      DelegationRequiredError,
    );
    await expect(
      courses.markLessonComplete(agent, w.communityId, w.lesson.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await entitlements.revokeDelegation(user(w.member), w.communityId, delegation.id);
    await expect(courses.getCourse(agent, w.communityId, w.course.slug)).rejects.toMatchObject({
      reason: "revoked",
    });
  });

  it("keeps course access for agents of owners and admins without a delegation", async () => {
    const w = await setup();
    const adminAgent = newId();
    await db.insert(agentIdentities).values({
      id: adminAgent,
      communityId: w.communityId,
      ownerId: w.admin,
      name: "Author",
      scopes: ["courses:read", "courses:write"],
      createdBy: w.admin,
    });
    const agent = agentOf(w.communityId, w.admin, adminAgent);
    expect((await courses.getCourse(agent, w.communityId, w.other.slug)).id).toBe(w.other.id);
  });
});
