import { ApprovalRequiredError, ForbiddenError, type Actor } from "@cohory/authz";
import type { CommunityId } from "@cohory/db";
import { courseAgentVersions } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";

import { sha256Hex, type AgentLessonLayerInput } from "./agent";
import { CourseNotFoundError, CoursesValidationError } from "./errors";
import { createPostgresCoursesRepository } from "./postgres-repository";
import { createCoursesService } from "./service";
import { validLayer } from "./test/agent-layers";
import { insertCommunity, insertMember, memoryStorage, openTestDb, user } from "./test/fixtures";

const { db, close } = openTestDb();
const storage = memoryStorage();
let clock = new Date("2026-10-19T10:00:00Z");
const courses = createCoursesService({
  repo: createPostgresCoursesRepository(db),
  storage,
  appUrl: "https://cohory.example/",
  now: () => clock,
});

afterAll(async () => {
  await close();
});

const lessonBody =
  "# Plan a release\n\nKeep releases small.\n\n## Exercises\n\n1. Write a checklist.\n";

async function world() {
  const communityId: CommunityId = await insertCommunity(db);
  const roles = {
    owner: await insertMember(db, communityId, "owner"),
    admin: await insertMember(db, communityId, "admin"),
    moderator: await insertMember(db, communityId, "moderator"),
    member: await insertMember(db, communityId, "member"),
  };
  const admin = user(roles.admin);
  const course = await courses.createCourse(admin, communityId, { title: "Release engineering" });
  const module = await courses.createModule(admin, communityId, course.slug, { title: "Basics" });
  const lesson = await courses.createLesson(admin, communityId, course.slug, module.id, {
    title: "Checklists",
    bodyMarkdown: lessonBody,
  });
  const draft = await courses.createLesson(admin, communityId, course.slug, module.id, {
    title: "Draft lesson",
  });
  await courses.publishLesson(admin, communityId, lesson.id);
  await courses.publishCourse(admin, communityId, course.slug);
  return { communityId, roles, admin, course, lesson, draft };
}

type World = Awaited<ReturnType<typeof world>>;

async function layerWithUpload(w: World): Promise<AgentLessonLayerInput> {
  const file = await courses.uploadAgentFile(w.admin, w.communityId, w.course.id, {
    bytes: new TextEncoder().encode("# Checklist\n\n- Test\n- Roll back\n"),
    name: "Release checklist (v2).md",
    declaredType: "text/markdown",
  });
  return validLayer({ references: [{ title: "Checklist", file }] });
}

const license = { id: "personal-agent-use" as const, text: "" };

async function publishFirst(w: World) {
  await courses.saveLessonAgentLayer(w.admin, w.communityId, w.lesson.id, await layerWithUpload(w));
  return courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
    bump: "major",
    changelog: "First version.",
    license,
  });
}

describe("agent material authoring", () => {
  it("saves a layer, publishes 1.0.0 with published lessons only, and lists it", async () => {
    const w = await world();
    await courses.saveLessonAgentLayer(
      w.admin,
      w.communityId,
      w.draft.id,
      validLayer({ references: [] }),
    );
    const version = await publishFirst(w);

    expect(version.version).toBe("1.0.0");
    expect(version.checksum).toMatch(/^[0-9a-f]{64}$/);
    const authoring = await courses.getAgentAuthoring(w.admin, w.communityId, w.course.slug);
    expect(authoring.versions.map((row) => row.version)).toEqual(["1.0.0"]);
    expect(authoring.nextVersions).toEqual({ patch: "1.0.1", minor: "1.1.0", major: "2.0.0" });
    expect(
      authoring.lessons.map((row) => [row.title, row.hasLayer, row.includedOnPublish]),
    ).toEqual([
      ["Checklists", true, true],
      ["Draft lesson", true, false],
    ]);
    const material = await courses.getAgentMaterial(w.admin, w.communityId, w.course.id);
    expect(material.lessons.map((lesson) => lesson.title)).toEqual(["Checklists"]);
    expect(material.manifest.sourceUrl).toBe(
      `https://cohory.example/c/${await communitySlug(w.communityId)}/classroom/${w.course.slug}`,
    );
    expect(material.lessons[0]?.references[0]?.file.name).toBe("Release-checklist-v2.md");
  });

  it("drafts a layer from the lesson body without saving or publishing it", async () => {
    const w = await world();
    const draft = await courses.draftLessonAgentLayer(w.admin, w.communityId, w.lesson.id);
    expect(draft.objective).toBe("Plan a release");
    expect(draft.tasks.map((task) => task.prompt)).toEqual(["Write a checklist."]);
    const view = await courses.getLessonAgentLayer(w.admin, w.communityId, w.lesson.id);
    expect(view.layer).toBeNull();
    expect(await courses.listAgentVersions(w.admin, w.communityId, w.course.slug)).toEqual([]);
  });

  it("bumps versions by the rules and refuses an unchanged publish", async () => {
    const w = await world();
    await publishFirst(w);
    await expect(
      courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
        bump: "patch",
        license,
      }),
    ).rejects.toThrow(CoursesValidationError);

    const layer = await layerWithUpload(w);
    await courses.saveLessonAgentLayer(w.admin, w.communityId, w.lesson.id, {
      ...layer,
      objective: "Write a better checklist",
    });
    const minor = await courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
      bump: "minor",
      license,
    });
    expect(minor.version).toBe("1.1.0");
    await courses.saveLessonAgentLayer(w.admin, w.communityId, w.lesson.id, {
      ...layer,
      objective: "Again",
    });
    const patch = await courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
      bump: "patch",
      license,
    });
    expect(patch.version).toBe("1.1.1");
    const first = await courses.getAgentMaterial(w.admin, w.communityId, w.course.id, {
      version: "1.0.0",
    });
    expect(first.lessons[0]?.objective).toBe(validLayer().objective);
  });

  it("keeps published versions immutable in the database", async () => {
    const w = await world();
    const version = await publishFirst(w);
    await expect(
      db
        .update(courseAgentVersions)
        .set({ changelog: "rewritten" })
        .where(eq(courseAgentVersions.id, version.id)),
    ).rejects.toThrow();
    const rows = await db
      .select()
      .from(courseAgentVersions)
      .where(eq(courseAgentVersions.id, version.id));
    expect(rows[0]?.changelog).toBe("First version.");
  });

  it("exports byte identical zips for the same version", async () => {
    const w = await world();
    await publishFirst(w);
    const first = await courses.exportAgentVersion(w.admin, w.communityId, w.course.slug, "1.0.0");
    clock = new Date(clock.getTime() + 86_400_000);
    const second = await courses.exportAgentVersion(w.admin, w.communityId, w.course.slug, "1.0.0");
    expect(sha256Hex(first.bytes)).toBe(sha256Hex(second.bytes));
    expect(first.fileName).toBe("release-engineering-1.0.0.zip");
    const entries = Object.keys(unzipSync(first.bytes));
    expect(entries).toContain("release-engineering/SKILL.md");
    expect(entries).toContain(
      "release-engineering/references/001-checklists/Release-checklist-v2.md",
    );
  });

  it("refuses files from another course or community", async () => {
    const w = await world();
    const other = await world();
    const foreign = await layerWithUpload(other);
    await expect(
      courses.saveLessonAgentLayer(w.admin, w.communityId, w.lesson.id, foreign),
    ).rejects.toThrow(CoursesValidationError);
  });

  it("refuses publishing when no published lesson has material", async () => {
    const w = await world();
    await expect(
      courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
        bump: "major",
        license,
      }),
    ).rejects.toThrow(CoursesValidationError);
  });

  it("refuses a license id that differs from the course agent access terms", async () => {
    const w = await world();
    await courses.saveLessonAgentLayer(
      w.admin,
      w.communityId,
      w.lesson.id,
      await layerWithUpload(w),
    );
    await expect(
      courses.publishAgentVersion(w.admin, w.communityId, w.course.slug, {
        bump: "major",
        license: { id: "custom", text: "" },
      }),
    ).rejects.toThrow(CoursesValidationError);
  });
});

describe("agent material permissions", () => {
  it("lets owners and admins author and publish", async () => {
    const w = await world();
    const owner = user(w.roles.owner);
    await courses.saveLessonAgentLayer(owner, w.communityId, w.lesson.id, await layerWithUpload(w));
    const version = await courses.publishAgentVersion(owner, w.communityId, w.course.slug, {
      bump: "major",
      license,
    });
    expect(version.version).toBe("1.0.0");
  });

  it.each(["moderator", "member"] as const)(
    "denies a %s authoring, publishing, or exporting",
    async (role) => {
      const w = await world();
      await publishFirst(w);
      const actor = user(w.roles[role]);
      await expect(
        courses.saveLessonAgentLayer(
          actor,
          w.communityId,
          w.lesson.id,
          validLayer({ references: [] }),
        ),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        courses.draftLessonAgentLayer(actor, w.communityId, w.lesson.id),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        courses.publishAgentVersion(actor, w.communityId, w.course.slug, {
          bump: "patch",
          license,
        }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        courses.exportAgentVersion(actor, w.communityId, w.course.slug, "1.0.0"),
      ).rejects.toThrow(ForbiddenError);
    },
  );

  it("lets entitled members read the published material and tasks", async () => {
    const w = await world();
    await publishFirst(w);
    const member = user(w.roles.member);
    const material = await courses.getAgentMaterial(member, w.communityId, w.course.id);
    expect(material.notice).toMatch(/data/);
    expect(JSON.stringify(material)).not.toContain("communities/");
    const task = await courses.getAgentTask(
      member,
      w.communityId,
      w.course.id,
      w.lesson.id,
      "write-checklist",
    );
    expect(task.evaluations).toHaveLength(3);
    const path = material.lessons[0]?.references[0]?.file.path ?? "";
    const file = await courses.getAgentMaterialFile(member, w.communityId, w.course.id, path);
    expect(new TextDecoder().decode(file.bytes)).toContain("Roll back");
    await expect(
      courses.getAgentMaterialFile(member, w.communityId, w.course.id, `../${path}`),
    ).rejects.toThrow(CourseNotFoundError);
    await expect(
      courses.getAgentTask(member, w.communityId, w.course.id, w.lesson.id, "missing"),
    ).rejects.toThrow(CourseNotFoundError);
  });

  it("hides material of a draft course from members and outsiders", async () => {
    const w = await world();
    await publishFirst(w);
    await courses.unpublishCourse(w.admin, w.communityId, w.course.slug);
    await expect(
      courses.getAgentMaterial(user(w.roles.member), w.communityId, w.course.id),
    ).rejects.toThrow(CourseNotFoundError);
    const guest: Actor = { kind: "guest" };
    await expect(courses.getAgentMaterial(guest, w.communityId, w.course.id)).rejects.toThrow();
  });

  it("does not cross communities", async () => {
    const w = await world();
    const other = await world();
    await publishFirst(w);
    await expect(
      courses.getAgentMaterial(other.admin, other.communityId, w.course.id),
    ).rejects.toThrow(CourseNotFoundError);
    await expect(
      courses.getAgentMaterial(user(other.roles.member), w.communityId, w.course.id),
    ).rejects.toThrow();
    await expect(
      courses.saveLessonAgentLayer(
        other.admin,
        other.communityId,
        w.lesson.id,
        validLayer({ references: [] }),
      ),
    ).rejects.toThrow(CourseNotFoundError);
  });

  it("asks for approval when an agent publishes", async () => {
    const w = await world();
    await courses.saveLessonAgentLayer(
      w.admin,
      w.communityId,
      w.lesson.id,
      await layerWithUpload(w),
    );
    const agent: Actor = {
      kind: "user",
      userId: w.roles.admin,
      platformAdmin: false,
      credential: {
        type: "agent",
        tokenId: "0190a000-0000-7000-8000-00000000aaaa",
        agentId: "0190a000-0000-7000-8000-00000000bbbb",
        communityId: w.communityId,
        scopes: ["courses:read", "courses:write"],
        via: "api",
      },
    };
    await expect(
      courses.publishAgentVersion(agent, w.communityId, w.course.slug, { bump: "major", license }),
    ).rejects.toThrow(ApprovalRequiredError);
  });
});

describe("agent material and delegated access", () => {
  it("asks the agent course access check before an agent reads material, tasks, or files", async () => {
    class DelegationRequired extends Error {}
    const calls: string[] = [];
    const gated = createCoursesService({
      repo: createPostgresCoursesRepository(db),
      storage,
      appUrl: "https://cohory.example",
      agentAccess: {
        delegatedCourseIds: async () => new Set<string>(),
        agentAccessFor: async () => ({ kind: "denied", reason: "no_delegation" }),
        courseAgentTerms: async () => new Map(),
        assertAgentCourseAccess: async (_actor, communityId, courseId) => {
          calls.push(`${communityId}:${courseId}`);
          throw new DelegationRequired("delegation_required");
        },
      },
    });
    const w = await world();
    await publishFirst(w);
    const agent: Actor = {
      kind: "user",
      userId: w.roles.member,
      platformAdmin: false,
      credential: {
        type: "agent",
        tokenId: "0190a000-0000-7000-8000-00000000cccc",
        agentId: "0190a000-0000-7000-8000-00000000dddd",
        communityId: w.communityId,
        scopes: ["courses:read"],
        via: "api",
      },
    };
    await expect(gated.getAgentMaterial(agent, w.communityId, w.course.id)).rejects.toThrow(
      DelegationRequired,
    );
    await expect(
      gated.getAgentTask(agent, w.communityId, w.course.id, w.lesson.id, "write-checklist"),
    ).rejects.toThrow(DelegationRequired);
    expect(calls).toEqual([`${w.communityId}:${w.course.id}`, `${w.communityId}:${w.course.id}`]);
    const human = await gated.getAgentMaterial(user(w.roles.member), w.communityId, w.course.id);
    expect(human.manifest.version).toBe("1.0.0");
    expect(calls).toHaveLength(2);
  });
});

async function communitySlug(communityId: string): Promise<string> {
  const result = await db.execute<{ slug: string }>(
    sql`select slug from communities where id = ${communityId}`,
  );
  return result.rows[0]?.slug ?? "";
}
