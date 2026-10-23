"use server";

import { getCoursesService } from "@cohory/api/services";
import {
  CoursesValidationError,
  jsonSchemaProblem,
  maxJsonDocumentBytes,
  versionBumps,
} from "@cohory/courses";
import type { AgentLayerFormValue } from "@cohory/ui";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveCommunity } from "../posts/context";
import type { ActionResult } from "../posts/errors";
import { formToLayer, layerToForm } from "./agent-form";
import { courseActionFailure } from "./errors";
import { classroomHref } from "./hrefs";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const text = (max: number) => z.string().max(max);
const jsonTooBig = "Keep this under 32 KB.";
const jsonDocument = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= maxJsonDocumentBytes, {
    message: jsonTooBig,
  });
const file = z.object({
  name: text(200),
  key: text(512),
  mediaType: text(100),
  size: z.int().min(0),
  sha256: text(64),
});
const formSchema = z.object({
  objective: text(2000),
  instructions: text(100_000),
  references: z.array(z.object({ title: text(500), file })).max(20),
  templates: z
    .array(
      z.union([
        z.object({ kind: z.literal("file"), title: text(500), file }),
        z.object({
          kind: z.literal("code"),
          title: text(500),
          name: text(200),
          language: text(60),
          content: text(100_000),
        }),
      ]),
    )
    .max(20),
  tasks: z
    .array(
      z.object({
        id: text(100),
        title: text(500),
        prompt: text(20_000),
        inputSchema: jsonDocument,
        outputSchema: jsonDocument,
      }),
    )
    .max(20),
  evaluations: z
    .array(
      z.object({
        taskId: text(100),
        kind: z.enum(["schema", "rubric", "script"]),
        spec: text(100_000),
      }),
    )
    .max(40),
});

export type AgentLayerActionResult =
  { ok: true } | { ok: false; message: string; fieldErrors: Record<string, string> };

function fieldErrorsOf(error: CoursesValidationError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message]));
}

function layerFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.path[0] !== "layer") continue;
    fieldErrors[issue.path.slice(1).map(String).join(".")] ??= issue.message;
  }
  return fieldErrors;
}

export async function saveLessonAgentLayerAction(raw: {
  slug: string;
  lessonId: string;
  layer: AgentLayerFormValue;
}): Promise<AgentLayerActionResult> {
  try {
    const input = z.object({ slug, lessonId: z.uuid(), layer: formSchema }).parse(raw);
    const converted = formToLayer(input.layer);
    if (!converted.ok) {
      return {
        ok: false,
        message: "Fix the JSON fields marked below.",
        fieldErrors: converted.fieldErrors,
      };
    }
    const context = await resolveCommunity(input.slug);
    await getCoursesService().saveLessonAgentLayer(
      context.access.actor,
      context.communityId,
      input.lessonId,
      converted.input,
    );
    revalidatePath(classroomHref(context.slug), "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof CoursesValidationError) {
      return {
        ok: false,
        message: error.issues[0]?.message ?? "Check the agent material and try again.",
        fieldErrors: fieldErrorsOf(error),
      };
    }
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        message: error.issues[0]?.message ?? "Check the agent material and try again.",
        fieldErrors: layerFieldErrors(error),
      };
    }
    const failure = courseActionFailure(error);
    if (failure) return { ok: false, message: failure.message, fieldErrors: {} };
    throw error;
  }
}

export async function draftLessonAgentLayerAction(raw: {
  slug: string;
  lessonId: string;
}): Promise<ActionResult<AgentLayerFormValue>> {
  try {
    const input = z.object({ slug, lessonId: z.uuid() }).parse(raw);
    const context = await resolveCommunity(input.slug);
    const layer = await getCoursesService().draftLessonAgentLayer(
      context.access.actor,
      context.communityId,
      input.lessonId,
    );
    return { ok: true, data: layerToForm(layer) };
  } catch (error) {
    const failure = courseActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export async function checkAgentJsonAction(raw: {
  kind: "schema" | "spec";
  text: string;
}): Promise<string | null> {
  const parsed = z.object({ kind: z.enum(["schema", "spec"]), text: jsonDocument }).safeParse(raw);
  if (!parsed.success) return jsonTooBig;
  let value: unknown;
  try {
    value = JSON.parse(parsed.data.text) as unknown;
  } catch {
    return "This is not valid JSON. Check quotes, commas, and brackets.";
  }
  if (parsed.data.kind === "schema") return jsonSchemaProblem(value);
  if (typeof value !== "object" || value === null || !("schema" in value)) {
    return 'Put the JSON Schema under "schema".';
  }
  return jsonSchemaProblem(value.schema);
}

export async function publishAgentVersionAction(raw: {
  slug: string;
  courseSlug: string;
  bump: string;
  changelog: string;
}): Promise<ActionResult<{ version: string }>> {
  try {
    const input = z
      .object({
        slug,
        courseSlug: z.string().trim().min(1).max(200),
        bump: z.enum(versionBumps),
        changelog: text(2000),
      })
      .parse(raw);
    const context = await resolveCommunity(input.slug);
    const version = await getCoursesService().publishAgentVersion(
      context.access.actor,
      context.communityId,
      input.courseSlug,
      { bump: input.bump, changelog: input.changelog },
    );
    revalidatePath(classroomHref(context.slug), "layout");
    return { ok: true, data: { version: version.version } };
  } catch (error) {
    const failure = courseActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}
