import { expect } from "vitest";

export interface CallInit {
  readonly method?: string;
  readonly cookie?: string;
  readonly token?: string;
  readonly body?: unknown;
}

export type Call = (path: string, init?: CallInit) => Promise<Response>;

export interface PublishedMaterial {
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
}

export const fixtureTaskId = "write-checklist";

export function taskLayer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objective: "Write a release checklist for a small team",
    instructions: "Read the checklist, then adapt it to your team.",
    references: [],
    templates: [
      {
        kind: "code",
        title: "Release script",
        name: "release.sh",
        language: "bash",
        content: "#!/bin/sh\necho release\n",
      },
    ],
    tasks: [
      {
        id: fixtureTaskId,
        title: "Write the checklist",
        prompt: "Write a checklist for your team.",
        inputSchema: { type: "object", properties: { team: { type: "string" } } },
        outputSchema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" } } },
          required: ["items"],
        },
      },
    ],
    evaluations: [
      {
        taskId: fixtureTaskId,
        kind: "schema",
        spec: { schema: { type: "object", required: ["items"] } },
      },
    ],
    ...overrides,
  };
}

async function body<T>(response: Response, status: number, label: string): Promise<T> {
  const text = await response.text();
  expect(response.status, `${label}: ${text}`).toBe(status);
  return JSON.parse(text) as T;
}

export async function publishAgentMaterial(
  call: Call,
  slug: string,
  courseSlug: string,
  cookie: string,
  layer: Record<string, unknown> = taskLayer(),
): Promise<PublishedMaterial> {
  const module = await body<{ id: string }>(
    await call(`/communities/${slug}/courses/${courseSlug}/modules`, {
      method: "POST",
      cookie,
      body: { title: "Basics" },
    }),
    201,
    "create module",
  );
  const lesson = await body<{ id: string }>(
    await call(`/communities/${slug}/courses/${courseSlug}/modules/${module.id}/lessons`, {
      method: "POST",
      cookie,
      body: { title: "Checklists", bodyMarkdown: "# Checklists\n\nKeep releases small.\n" },
    }),
    201,
    "create lesson",
  );
  await body(
    await call(`/communities/${slug}/lessons/${lesson.id}/publish`, { method: "POST", cookie }),
    200,
    "publish lesson",
  );
  await body(
    await call(`/communities/${slug}/lessons/${lesson.id}/agent-layer`, {
      method: "PUT",
      cookie,
      body: layer,
    }),
    200,
    "save agent layer",
  );
  const version = await body<{ version: string }>(
    await call(`/communities/${slug}/courses/${courseSlug}/agent-versions`, {
      method: "POST",
      cookie,
      body: { bump: "major" },
    }),
    201,
    "publish agent version",
  );
  return { lessonId: lesson.id, taskId: fixtureTaskId, version: version.version };
}
