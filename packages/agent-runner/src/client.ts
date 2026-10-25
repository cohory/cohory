import { z } from "zod";

import type { Evaluation, EvaluationReport } from "./evaluate";

export interface RunnerOptions {
  readonly baseUrl: string;
  readonly community: string;
  readonly token: string;
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export interface TaskRef {
  readonly courseId: string;
  readonly lessonId: string;
  readonly taskId: string;
  readonly version: string;
}

export interface Environment {
  readonly runner: string;
  readonly runnerVersion: string;
  readonly node: string;
  readonly platform: string;
  readonly [key: string]: string;
}

const evaluationSchema = z.discriminatedUnion("kind", [
  z.object({
    taskId: z.string(),
    kind: z.literal("schema"),
    spec: z.object({ schema: z.unknown() }),
  }),
  z.object({
    taskId: z.string(),
    kind: z.literal("rubric"),
    spec: z.object({
      criteria: z.array(z.object({ id: z.string(), points: z.number() })),
      passingScore: z.number(),
    }),
  }),
  z.object({
    taskId: z.string(),
    kind: z.literal("script"),
    spec: z.object({ language: z.string(), source: z.string() }),
  }),
]);

const taskSchema = z.object({
  version: z.string(),
  checksum: z.string(),
  task: z.object({ id: z.string(), outputSchema: z.unknown() }),
  evaluations: z.array(evaluationSchema),
});

export class RunnerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export const runnerVersion = "0.13.0";

export function defaultEnvironment(): Environment {
  return {
    runner: "@cohory/agent-runner",
    runnerVersion,
    node: process.versions.node,
    platform: process.platform,
  };
}

export function buildSubmission(
  ref: TaskRef,
  runId: string,
  output: unknown,
  report: EvaluationReport,
  environment: Environment,
) {
  return {
    lessonId: ref.lessonId,
    taskId: ref.taskId,
    version: ref.version,
    runId,
    payload: { outcome: report.outcome, checks: report.checks, output, environment },
  };
}

export function createRunnerClient(options: RunnerOptions) {
  const base = new URL(options.baseUrl);
  const doFetch = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const prefix = `/api/v1/communities/${encodeURIComponent(options.community)}`;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = new URL(`${prefix}${path}`, base);
    if (url.origin !== base.origin) {
      throw new RunnerError(0, "wrong_origin", "The runner only talks to the Cohory API.");
    }
    const response = await doFetch(url.toString(), {
      ...init,
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(body);
      throw new RunnerError(
        response.status,
        error.success ? error.data.error.code : `http_${response.status}`,
        error.success ? error.data.error.message : "The request failed.",
      );
    }
    return body;
  }

  return {
    async getTask(
      ref: TaskRef,
    ): Promise<{ task: { id: string; outputSchema: unknown }; evaluations: Evaluation[] }> {
      const path = `/courses/${encodeURIComponent(ref.courseId)}/agent-material/lessons/${encodeURIComponent(ref.lessonId)}/tasks/${encodeURIComponent(ref.taskId)}?version=${encodeURIComponent(ref.version)}`;
      const parsed = taskSchema.parse(await request(path));
      return { task: parsed.task, evaluations: parsed.evaluations };
    },

    async submit(
      courseId: string,
      submission: ReturnType<typeof buildSubmission>,
    ): Promise<unknown> {
      return request(`/courses/${encodeURIComponent(courseId)}/submissions`, {
        method: "POST",
        body: JSON.stringify(submission),
      });
    },
  };
}
