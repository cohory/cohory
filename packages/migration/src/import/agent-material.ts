import {
  agentLessonLayerSchema,
  agentSnapshotSchema,
  rebaseSnapshot,
  type AgentFile,
  type AgentLessonLayer,
} from "@cohory/courses/agent-format";
import { courseAgentSettings, courseAgentVersions, lessonAgentLayers } from "@cohory/db/schema";

import type { ArchiveRecord } from "../format/records";
import type { MigrationTx } from "../scope";
import type { IdMap } from "./id-map";
import type { SkipLog } from "./summary";

export interface AgentRestoreItem<R> {
  readonly row: R;
  readonly id: string;
}

export type AgentRestorePhase = <R>(
  entity: string,
  rows: readonly R[],
  key: (row: R) => string,
  write: (tx: MigrationTx, items: AgentRestoreItem<R>[]) => Promise<ReadonlySet<string>>,
) => Promise<void>;

export interface AgentRestoreContext {
  readonly phase: AgentRestorePhase;
  readonly map: IdMap;
  readonly skips: SkipLog;
  readonly target: string;
  readonly rewriteKey: (key: string) => string | null;
  readonly sourceUrl: (sourceCourseId: string, snapshotSlug: string, original: string) => string;
}

type LayerRow = ArchiveRecord<"lesson_agent_layers">;
type VersionRow = ArchiveRecord<"course_agent_versions">;
type SettingsRow = ArchiveRecord<"course_agent_settings">;

function rebaseLayer(layer: AgentLessonLayer, rewriteKey: (key: string) => string | null) {
  let missing = false;
  const move = (file: AgentFile): AgentFile => {
    const key = rewriteKey(file.key);
    if (!key) missing = true;
    return { ...file, key: key ?? file.key };
  };
  const rebased: AgentLessonLayer = {
    ...layer,
    references: layer.references.map((reference) => ({ ...reference, file: move(reference.file) })),
    templates: layer.templates.map((template) =>
      template.kind === "file" ? { ...template, file: move(template.file) } : template,
    ),
  };
  return missing ? null : rebased;
}

export async function restoreAgentMaterial(
  context: AgentRestoreContext,
  records: {
    readonly layers: readonly LayerRow[];
    readonly versions: readonly VersionRow[];
    readonly settings: readonly SettingsRow[];
  },
): Promise<void> {
  const { phase, map, skips, target, rewriteKey } = context;

  await phase(
    "lesson_agent_layers",
    records.layers,
    (row) => row.lessonId,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row } of items) {
        const lessonId = map.get("lessons", row.lessonId);
        const courseId = map.get("courses", row.courseId);
        const parsed = agentLessonLayerSchema.safeParse(row.layer);
        const layer = parsed.success ? rebaseLayer(parsed.data, rewriteKey) : null;
        if (!lessonId || !courseId || !layer) {
          skips.add(
            "lesson_agent_layers",
            row.lessonId,
            layer
              ? "The lesson is not in the archive."
              : "The agent material or one of its files is not valid.",
          );
          skipped.add(row.lessonId);
          continue;
        }
        await tx.insert(lessonAgentLayers).values({
          lessonId,
          communityId: target,
          courseId,
          layer: { ...layer },
          updatedBy: null,
          updatedAt: new Date(row.updatedAt),
        });
      }
      return skipped;
    },
  );

  await phase(
    "course_agent_versions",
    records.versions,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const courseId = map.get("courses", row.courseId);
        const parsed = agentSnapshotSchema.safeParse(row.snapshot);
        const rebased =
          courseId && parsed.success
            ? rebaseSnapshot(parsed.data, {
                courseId,
                lessonId: (sourceId) => map.get("lessons", sourceId),
                key: rewriteKey,
                sourceUrl: context.sourceUrl(
                  row.courseId,
                  parsed.data.manifest.course.slug,
                  parsed.data.manifest.sourceUrl,
                ),
              })
            : null;
        if (!courseId || !rebased) {
          skips.add(
            "course_agent_versions",
            row.id,
            "The version refers to a course, lesson, or file that is not in the archive.",
          );
          skipped.add(row.id);
          continue;
        }
        await tx.insert(courseAgentVersions).values({
          id,
          communityId: target,
          courseId,
          version: row.version,
          major: row.major,
          minor: row.minor,
          patch: row.patch,
          changelog: row.changelog,
          snapshot: { ...rebased.snapshot },
          checksum: rebased.checksum,
          publishedBy: null,
          createdAt: new Date(row.createdAt),
        });
      }
      return skipped;
    },
  );

  await phase(
    "course_agent_settings",
    records.settings,
    (row) => row.courseId,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row } of items) {
        const courseId = map.get("courses", row.courseId);
        if (!courseId) {
          skips.add("course_agent_settings", row.courseId, "The course is not in the archive.");
          skipped.add(row.courseId);
          continue;
        }
        await tx.insert(courseAgentSettings).values({
          courseId,
          communityId: target,
          allowAgentAccess: row.allowAgentAccess,
          licenseId: row.licenseId,
          licenseText: row.licenseText,
          updatedBy: null,
          updatedAt: new Date(row.updatedAt),
        });
      }
      return skipped;
    },
  );
}
