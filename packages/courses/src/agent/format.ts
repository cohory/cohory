import { z } from "zod";

import {
  checkJsonDocument,
  isJsonValue,
  jsonSchemaProblem,
  jsonSize,
  type JsonValue,
} from "./json-schema";
import { hasRawHtml, markdownText, plainLine } from "./text";

export const agentCourseFormat = "cohory-agent-course";
export const agentCourseFormatVersion = "1.1.0";

export const agentLimits = {
  objective: 500,
  instructions: 50_000,
  title: 120,
  fileName: 100,
  references: 20,
  templates: 20,
  codeTemplate: 50_000,
  tasks: 20,
  prompt: 10_000,
  evaluations: 40,
  rubricCriteria: 20,
  scriptSource: 50_000,
  changelog: 2_000,
  licenseText: 20_000,
  courseDescription: 1_024,
  lessonsPerVersion: 500,
  snapshotBytes: 2 * 1024 * 1024,
  filesBytesPerVersion: 50 * 1024 * 1024,
} as const;

export const agentLicenseIds = [
  "personal-agent-use",
  "team-agent-use",
  "all-rights-reserved",
  "cc-by-4.0",
  "cc-by-sa-4.0",
  "mit",
  "custom",
] as const;

export type AgentLicenseId = (typeof agentLicenseIds)[number];

export const agentLicenseLabels: Readonly<Record<AgentLicenseId, string>> = {
  "personal-agent-use": "Personal use by the buyer's agents only",
  "team-agent-use": "Use by agents of the buyer's own team",
  "all-rights-reserved": "All rights reserved",
  "cc-by-4.0": "CC BY 4.0",
  "cc-by-sa-4.0": "CC BY-SA 4.0",
  mit: "MIT",
  custom: "Custom terms",
};

const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const taskIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const languagePattern = /^[a-z0-9][a-z0-9+#.-]{0,29}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function line(max: number) {
  return z
    .string()
    .transform(plainLine)
    .pipe(z.string().min(1, { error: "Fill this in." }).max(max));
}

function markdown(max: number, required: boolean) {
  return z
    .string()
    .transform(markdownText)
    .pipe(
      z
        .string()
        .min(required ? 1 : 0, { error: "Fill this in." })
        .max(max)
        .refine((value) => !hasRawHtml(value), {
          error: "Use Markdown only. Raw HTML such as <script> or <div> is not allowed.",
        }),
    );
}

export const agentFileNameSchema = z
  .string()
  .transform(plainLine)
  .pipe(
    z
      .string()
      .min(1)
      .max(agentLimits.fileName)
      .regex(fileNamePattern, {
        error: "Use letters, numbers, dots, dashes, and underscores, with no folders.",
      })
      .refine((name) => !name.includes(".."), { error: "Two dots in a row are not allowed." }),
  );

export const jsonSchemaField = z.unknown().transform((value, context): JsonValue => {
  const problem = jsonSchemaProblem(value);
  if (problem || !isJsonValue(value)) {
    context.addIssue({ code: "custom", message: problem ?? "Use plain JSON values only." });
    return z.NEVER;
  }
  return value;
});

export const agentFileSchema = z.strictObject({
  name: agentFileNameSchema,
  key: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(100),
  size: z
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  sha256: z.string().regex(sha256Pattern),
});

export const agentReferenceSchema = z.strictObject({
  title: line(agentLimits.title),
  file: agentFileSchema,
});

export const agentTemplateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file"),
    title: line(agentLimits.title),
    file: agentFileSchema,
  }),
  z.strictObject({
    kind: z.literal("code"),
    title: line(agentLimits.title),
    name: agentFileNameSchema,
    language: z
      .string()
      .regex(languagePattern, { error: "Use a short language name such as python." }),
    content: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(z.string().min(1, { error: "Add the code." }).max(agentLimits.codeTemplate)),
  }),
]);

export const agentTaskSchema = z.strictObject({
  id: z.string().regex(taskIdPattern, {
    error: "Use lowercase letters, numbers, and dashes, up to 64 characters.",
  }),
  title: line(agentLimits.title),
  prompt: markdown(agentLimits.prompt, true),
  inputSchema: jsonSchemaField,
  outputSchema: jsonSchemaField,
});

const rubricCriterion = z.strictObject({
  id: z.string().regex(taskIdPattern),
  description: line(500),
  points: z.int().min(0).max(100),
});

export const evaluationKinds = ["schema", "rubric", "script"] as const;
export type EvaluationKind = (typeof evaluationKinds)[number];

export const agentEvaluationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    taskId: z.string().regex(taskIdPattern),
    kind: z.literal("schema"),
    spec: z.strictObject({ schema: jsonSchemaField }),
  }),
  z.strictObject({
    taskId: z.string().regex(taskIdPattern),
    kind: z.literal("rubric"),
    spec: z.strictObject({
      criteria: z.array(rubricCriterion).min(1).max(agentLimits.rubricCriteria),
      passingScore: z.int().min(0).max(10_000),
    }),
  }),
  z.strictObject({
    taskId: z.string().regex(taskIdPattern),
    kind: z.literal("script"),
    spec: z.strictObject({
      language: z.string().regex(languagePattern),
      source: z
        .string()
        .transform((value) => value.replace(/\r\n?/g, "\n"))
        .pipe(z.string().min(1).max(agentLimits.scriptSource)),
    }),
  }),
]);

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values.map((item) => item.toLowerCase())) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export const agentLessonLayerSchema = z
  .strictObject({
    objective: line(agentLimits.objective),
    instructions: markdown(agentLimits.instructions, false),
    references: z.array(agentReferenceSchema).max(agentLimits.references),
    templates: z.array(agentTemplateSchema).max(agentLimits.templates),
    tasks: z.array(agentTaskSchema).max(agentLimits.tasks),
    evaluations: z.array(agentEvaluationSchema).max(agentLimits.evaluations),
  })
  .superRefine((layer, context) => {
    for (const id of duplicates(layer.tasks.map((task) => task.id))) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `Task id "${id}" is used twice.`,
      });
    }
    const names = layer.references.map((reference) => reference.file.name);
    for (const name of duplicates(names)) {
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: `"${name}" is used twice.`,
      });
    }
    const templateNames = layer.templates.map((template) =>
      template.kind === "file" ? template.file.name : template.name,
    );
    for (const name of duplicates(templateNames)) {
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: `"${name}" is used twice.`,
      });
    }
    const taskIds = new Set(layer.tasks.map((task) => task.id));
    layer.evaluations.forEach((evaluation, index) => {
      if (!taskIds.has(evaluation.taskId)) {
        context.addIssue({
          code: "custom",
          path: ["evaluations", index, "taskId"],
          message: `No task has the id "${evaluation.taskId}".`,
        });
      }
    });
  });

export type AgentLessonLayer = z.output<typeof agentLessonLayerSchema>;
export type AgentLessonLayerInput = z.input<typeof agentLessonLayerSchema>;
export type AgentFile = z.output<typeof agentFileSchema>;
export type AgentReference = z.output<typeof agentReferenceSchema>;
export type AgentTemplate = z.output<typeof agentTemplateSchema>;
export type AgentTask = z.output<typeof agentTaskSchema>;
export type AgentEvaluation = z.output<typeof agentEvaluationSchema>;

export const semverSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/, {
    error: "Use a version like 1.2.3.",
  });

export const agentLicenseSchema = z.strictObject({
  id: z.enum(agentLicenseIds),
  text: markdown(agentLimits.licenseText, false),
});

export type AgentLicense = z.output<typeof agentLicenseSchema>;

export const agentManifestSchema = z.strictObject({
  format: z.literal(agentCourseFormat),
  formatVersion: semverSchema,
  course: z.strictObject({
    id: z.uuid(),
    slug: z.string().min(1).max(120),
    title: z.string().min(1).max(120),
    description: z.string().max(agentLimits.courseDescription),
  }),
  version: semverSchema,
  changelog: z.string().max(agentLimits.changelog),
  publishedAt: z.iso.datetime({ offset: true }),
  license: agentLicenseSchema,
  sourceUrl: z.url({ protocol: /^https?$/ }),
  contentSha256: z.string().regex(sha256Pattern),
});

export type AgentManifest = z.output<typeof agentManifestSchema>;

export const agentSnapshotLessonSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  position: z.int().min(1),
  layer: agentLessonLayerSchema,
});

export const agentSnapshotSchema = z
  .strictObject({
    manifest: agentManifestSchema,
    lessons: z.array(agentSnapshotLessonSchema).max(agentLimits.lessonsPerVersion),
  })
  .superRefine((snapshot, context) => {
    if (jsonSize(snapshot) > agentLimits.snapshotBytes) {
      context.addIssue({
        code: "custom",
        message: `The agent material is over ${agentLimits.snapshotBytes / 1024 / 1024} MB.`,
      });
    }
    const files = snapshot.lessons.flatMap(({ layer }) => [
      ...layer.references.map((reference) => reference.file.size),
      ...layer.templates.flatMap((template) =>
        template.kind === "file" ? [template.file.size] : [],
      ),
    ]);
    if (files.reduce((sum, size) => sum + size, 0) > agentLimits.filesBytesPerVersion) {
      context.addIssue({
        code: "custom",
        message: `Files in one version add up to more than ${agentLimits.filesBytesPerVersion / 1024 / 1024} MB.`,
      });
    }
  });

export type AgentSnapshot = z.output<typeof agentSnapshotSchema>;
export type AgentSnapshotLesson = z.output<typeof agentSnapshotLessonSchema>;

export function jsonDocumentProblem(value: unknown): string | null {
  return checkJsonDocument(value);
}
