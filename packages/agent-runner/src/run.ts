import { randomUUID } from "node:crypto";

import {
  buildSubmission,
  createRunnerClient,
  defaultEnvironment,
  type Environment,
  type RunnerOptions,
  type TaskRef,
} from "./client";
import { evaluateTask, type EvaluationReport } from "./evaluate";

export interface RunTaskInput extends RunnerOptions, TaskRef {
  readonly output: unknown;
  readonly runId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly submit?: boolean;
  readonly checkTimeoutMs?: number;
}

export async function runTask(input: RunTaskInput): Promise<{
  readonly runId: string;
  readonly report: EvaluationReport;
  readonly submitted: unknown;
}> {
  const client = createRunnerClient(input);
  const spec = await client.getTask(input);
  const report = await evaluateTask(spec, input.output, { timeoutMs: input.checkTimeoutMs });
  const runId = input.runId ?? randomUUID();
  if (input.submit === false) {
    return { runId, report, submitted: null };
  }
  const environment: Environment = { ...input.environment, ...defaultEnvironment() };
  const submitted = await client.submit(
    input.courseId,
    buildSubmission(input, runId, input.output, report, environment),
  );
  return { runId, report, submitted };
}
