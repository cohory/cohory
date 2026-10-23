import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import { parseCommunityId } from "@cohory/db";
import { agentCredentialOf, DelegationRequiredError } from "@cohory/entitlements";

import {
  agentContentNotice,
  sha256Hex,
  skillName,
  storedFiles,
  type AgentSnapshot,
  type AgentStoredFile,
} from "../agent";
import { buildSkillExport } from "../agent/skill";
import type {
  AgentCourseAccessKind,
  AgentCourseListing,
  AgentFileContent,
  AgentFileDownload,
  AgentSkillLink,
} from "../agent-views";
import {
  downloadLinkTtlMs,
  signDownload,
  verifyDownload,
  type DownloadGrant,
} from "../download-links";
import { CourseNotFoundError } from "../errors";
import { unlockedOnly, withAccess, type Access, type Runtime } from "./context";
import { readFile, readSnapshotFiles, requireVersion, snapshotOf } from "./agent-shared";
import { readableCourse } from "./agent-reading";

export const inlineTextMaxBytes = 32 * 1024;

const inlineMediaTypes: ReadonlySet<string> = new Set([
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/json",
]);

export interface AgentDeliveryOperations {
  listAgentCourses(actor: Actor, communityId: string): Promise<AgentCourseListing[]>;
  getAgentMaterialFileContent(
    actor: Actor,
    communityId: string,
    courseId: string,
    path: string,
    version?: string | null,
  ): Promise<AgentFileContent>;
  getSkillExportLink(
    actor: Actor,
    communityId: string,
    courseId: string,
    version?: string | null,
  ): Promise<AgentSkillLink>;
  openAgentDownload(communitySlug: string, token: string): Promise<AgentFileDownload>;
}

function requireSigner(runtime: Runtime): string {
  if (!runtime.downloadSecret) {
    throw new Error("agent downloads need BETTER_AUTH_SECRET");
  }
  return runtime.downloadSecret;
}

function requireUser(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor.userId;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function findStored(snapshot: AgentSnapshot, path: string): AgentStoredFile {
  const stored = storedFiles(snapshot).find((candidate) => candidate.path === path);
  if (!stored) {
    throw new CourseNotFoundError("agent_file");
  }
  return stored;
}

export function createAgentDeliveryOperations(runtime: Runtime): AgentDeliveryOperations {
  function link(communitySlug: string, grant: Omit<DownloadGrant, "expiresAt">) {
    const expiresAt = new Date(runtime.now().getTime() + downloadLinkTtlMs);
    const token = signDownload(requireSigner(runtime), { ...grant, expiresAt });
    return {
      url: `${runtime.appUrl}/api/v1/communities/${encodeURIComponent(communitySlug)}/agent-downloads/${token}`,
      expiresAt,
    };
  }

  async function accessKind(
    actor: Actor,
    access: Access,
    courseId: string,
  ): Promise<AgentCourseAccessKind> {
    const credential = agentCredentialOf(actor);
    if (!credential || actor.kind !== "user") {
      return access.manager ? { kind: "staff" } : { kind: "member" };
    }
    const grant = await runtime.agentAccess.agentAccessFor({
      communityId: access.community.id,
      courseId,
      agentId: credential.agentId,
      humanUserId: actor.userId,
    });
    if (grant.kind === "delegated") {
      return { kind: "delegated", expiresAt: grant.expiresAt };
    }
    return { kind: "staff" };
  }

  async function readBytes(stored: AgentStoredFile): Promise<Uint8Array> {
    const bytes = await readFile(runtime, stored.file.key);
    if (!bytes || sha256Hex(bytes) !== stored.file.sha256) {
      throw new CourseNotFoundError("agent_file");
    }
    return bytes;
  }

  return {
    listAgentCourses(actor, communityId) {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "course", access.context);
        const allowed = access.agentCourseIds;
        const courses = (
          await unlockedOnly(access, await access.store.listCourses(access.visibility))
        ).filter((course) => allowed === null || allowed.has(course.id));
        const versioned = (
          await Promise.all(
            courses.map(async (course) => {
              const [latest] = await access.store.listAgentVersions(course.id);
              return latest ? [{ course, latest }] : [];
            }),
          )
        ).flat();
        const terms = await runtime.agentAccess.courseAgentTerms(
          access.community.id,
          versioned.map(({ course }) => course.id),
        );
        const listings: AgentCourseListing[] = [];
        for (const { course, latest } of versioned) {
          const term = terms.get(course.id);
          if (!term) continue;
          listings.push({
            id: course.id,
            slug: course.slug,
            title: course.title,
            description: course.description ?? "",
            latestVersion: latest.version,
            checksum: latest.checksum,
            publishedAt: latest.createdAt,
            access: await accessKind(actor, access, course.id),
            allowAgentAccess: term.allowAgentAccess,
            license: term.license,
          });
        }
        return listings;
      });
    },

    async getAgentMaterialFileContent(actor, communityId, courseId, path, version) {
      const userId = requireUser(actor);
      const found = await withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "lesson", access.context);
        const course = await readableCourse(access, courseId);
        const row = await requireVersion(access, course, version);
        return {
          communityId: access.community.id,
          communitySlug: access.community.slug,
          courseId: course.id,
          version: row.version,
          stored: findStored(snapshotOf(row), path),
        };
      });
      const { file } = found.stored;
      const base = {
        notice: agentContentNotice,
        courseId: found.courseId,
        version: found.version,
        path: found.stored.path,
        name: file.name,
        mediaType: file.mediaType,
        size: file.size,
        sha256: file.sha256,
      };
      const baseType = file.mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (inlineMediaTypes.has(baseType) && file.size <= inlineTextMaxBytes) {
        const text = decodeText(await readBytes(found.stored));
        if (text !== null) {
          return { ...base, content: { kind: "text", text } };
        }
      }
      const signed = link(found.communitySlug, {
        kind: "file",
        communityId: found.communityId,
        courseId: found.courseId,
        version: found.version,
        path: found.stored.path,
        userId,
        agentId: agentCredentialOf(actor)?.agentId ?? null,
      });
      return { ...base, content: { kind: "link", ...signed } };
    },

    async getSkillExportLink(actor, communityId, courseId, version) {
      const userId = requireUser(actor);
      const agentId = agentCredentialOf(actor)?.agentId ?? null;
      const found = await withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "course", access.context);
        const course = await readableCourse(access, courseId);
        const row = await requireVersion(access, course, version);
        const terms = (
          await runtime.agentAccess.courseAgentTerms(access.community.id, [course.id])
        ).get(course.id);
        if (!terms) {
          throw new CourseNotFoundError("course");
        }
        if (agentId === null && !access.manager && !terms.allowAgentAccess) {
          throw new DelegationRequiredError("agent_access_off");
        }
        return {
          communityId: access.community.id,
          communitySlug: access.community.slug,
          course,
          row,
          terms,
        };
      });
      const snapshot = snapshotOf(found.row);
      return {
        notice: agentContentNotice,
        courseId: found.course.id,
        version: found.row.version,
        checksum: found.row.checksum,
        fileName: `${skillName(snapshot.manifest.course.slug)}-${found.row.version}.zip`,
        license: found.terms.license,
        ...link(found.communitySlug, {
          kind: "skill",
          communityId: found.communityId,
          courseId: found.course.id,
          version: found.row.version,
          path: null,
          userId,
          agentId,
        }),
      };
    },

    async openAgentDownload(communitySlug, token) {
      const grant = verifyDownload(requireSigner(runtime), token, runtime.now());
      if (!grant) {
        throw new CourseNotFoundError("agent_download");
      }
      const community = await runtime.repo.findCommunity(parseCommunityId(grant.communityId));
      if (!community || community.slug.toLowerCase() !== communitySlug.toLowerCase()) {
        throw new CourseNotFoundError("agent_download");
      }
      if (grant.agentId !== null) {
        const access = await runtime.agentAccess.agentAccessFor({
          communityId: grant.communityId,
          courseId: grant.courseId,
          agentId: grant.agentId,
          humanUserId: grant.userId,
        });
        if (access.kind === "denied") {
          throw new DelegationRequiredError(access.reason);
        }
        if (access.kind === "not_agent") {
          throw new CourseNotFoundError("agent_download");
        }
      }
      const person: Actor = { kind: "user", userId: grant.userId, platformAdmin: false };
      const row = await withAccess(runtime, person, grant.communityId, async (access) => {
        assertCan(person, "read", grant.kind === "file" ? "lesson" : "course", access.context);
        const course = await readableCourse(access, grant.courseId);
        return requireVersion(access, course, grant.version);
      });
      const snapshot = snapshotOf(row);
      if (grant.kind === "file" && grant.path !== null) {
        const stored = findStored(snapshot, grant.path);
        return {
          name: stored.file.name,
          mediaType: stored.file.mediaType,
          sha256: stored.file.sha256,
          bytes: await readBytes(stored),
        };
      }
      const skill = buildSkillExport(
        snapshot,
        row.checksum,
        await readSnapshotFiles(runtime, snapshot),
      );
      return {
        name: skill.fileName,
        mediaType: "application/zip",
        sha256: sha256Hex(skill.zip),
        bytes: skill.zip,
      };
    },
  };
}
