import type { LessonStatus } from "@cohory/db/schema";
import type { LicenseTerms } from "@cohory/entitlements";

import type {
  AgentEvaluation,
  AgentFile,
  AgentLessonLayer,
  AgentLicense,
  AgentTask,
  VersionBump,
} from "./agent";

export interface AgentVersionSummary {
  readonly id: string;
  readonly courseId: string;
  readonly version: string;
  readonly changelog: string;
  readonly checksum: string;
  readonly publishedAt: Date;
}

export interface AgentAuthoringLesson {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: LessonStatus;
  readonly moduleTitle: string;
  readonly hasLayer: boolean;
  readonly layerUpdatedAt: Date | null;
  readonly includedOnPublish: boolean;
}

export interface AgentAuthoring {
  readonly course: { readonly id: string; readonly slug: string; readonly title: string };
  readonly lessons: readonly AgentAuthoringLesson[];
  readonly versions: readonly AgentVersionSummary[];
  readonly nextVersions: Readonly<Record<VersionBump, string>>;
  readonly license: AgentLicense;
  readonly latestLicense: AgentLicense | null;
}

export interface LessonAgentLayerView {
  readonly lesson: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly status: LessonStatus;
    readonly courseId: string;
  };
  readonly layer: AgentLessonLayer | null;
  readonly updatedAt: Date | null;
}

export interface AgentTaskView {
  readonly notice: string;
  readonly course: { readonly id: string; readonly slug: string; readonly title: string };
  readonly version: string;
  readonly checksum: string;
  readonly lesson: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly position: number;
    readonly objective: string;
  };
  readonly task: AgentTask;
  readonly evaluations: readonly AgentEvaluation[];
}

export interface AgentFileDownload {
  readonly name: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface AgentSkillDownload {
  readonly fileName: string;
  readonly version: string;
  readonly checksum: string;
  readonly bytes: Uint8Array;
}

export type AgentFileRef = AgentFile;

export interface AgentMaterialOptions {
  readonly version?: string | null;
}

export type AgentCourseAccessKind =
  | { readonly kind: "delegated"; readonly expiresAt: Date }
  | { readonly kind: "staff" }
  | { readonly kind: "member" };

export interface AgentCourseListing {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly checksum: string;
  readonly publishedAt: Date;
  readonly access: AgentCourseAccessKind;
  readonly allowAgentAccess: boolean;
  readonly license: LicenseTerms;
}

export interface AgentDownloadLink {
  readonly url: string;
  readonly expiresAt: Date;
}

export type AgentFileBody =
  | { readonly kind: "text"; readonly text: string }
  | ({ readonly kind: "link" } & AgentDownloadLink);

export interface AgentFileContent {
  readonly notice: string;
  readonly courseId: string;
  readonly version: string;
  readonly path: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly content: AgentFileBody;
}

export interface AgentSkillLink extends AgentDownloadLink {
  readonly notice: string;
  readonly courseId: string;
  readonly version: string;
  readonly checksum: string;
  readonly fileName: string;
  readonly license: LicenseTerms;
}
