import { unsafePatterns } from "./patterns";
import { defaultCheckTimeoutMs, runSchemaCheck } from "./sandboxed-check";

export interface SchemaEvaluation {
  readonly taskId: string;
  readonly kind: "schema";
  readonly spec: { readonly schema: unknown };
}

export interface RubricEvaluation {
  readonly taskId: string;
  readonly kind: "rubric";
  readonly spec: {
    readonly criteria: readonly { readonly id: string; readonly points: number }[];
    readonly passingScore: number;
  };
}

export interface ScriptEvaluation {
  readonly taskId: string;
  readonly kind: "script";
  readonly spec: { readonly language: string; readonly source: string };
}

export type Evaluation = SchemaEvaluation | RubricEvaluation | ScriptEvaluation;

export interface TaskSpec {
  readonly task: { readonly id: string; readonly outputSchema: unknown };
  readonly evaluations: readonly Evaluation[];
}

export type Check =
  | {
      readonly kind: "output_schema" | "schema";
      readonly index: number | null;
      readonly status: "passed" | "failed";
      readonly errors: readonly string[];
    }
  | {
      readonly kind: "rubric";
      readonly index: number;
      readonly status: "needs_judgement";
      readonly criteria: readonly string[];
      readonly passingScore: number;
    }
  | {
      readonly kind: "script";
      readonly index: number;
      readonly status: "not_run";
      readonly reason: string;
    };

export interface EvaluationReport {
  readonly outcome: "passed" | "failed";
  readonly checks: readonly Check[];
}

export const scriptNotRunReason =
  "This runner never runs scripts. Review the script and run it yourself in your own sandbox if you choose.";

export interface EvaluateOptions {
  readonly timeoutMs?: number;
}

async function validate(schema: unknown, output: unknown, timeoutMs: number): Promise<string[]> {
  if (typeof schema !== "boolean" && (typeof schema !== "object" || schema === null)) {
    return ["The schema is not a JSON Schema."];
  }
  const unsafe = unsafePatterns(schema);
  if (unsafe.length > 0) {
    return unsafe;
  }
  return runSchemaCheck(schema, output, timeoutMs);
}

async function schemaCheck(
  kind: "output_schema" | "schema",
  index: number | null,
  schema: unknown,
  output: unknown,
  timeoutMs: number,
): Promise<Check> {
  const errors = await validate(schema, output, timeoutMs);
  return { kind, index, status: errors.length === 0 ? "passed" : "failed", errors };
}

export async function evaluateTask(
  spec: TaskSpec,
  output: unknown,
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const timeoutMs = options.timeoutMs ?? defaultCheckTimeoutMs;
  const checks: Check[] = [
    await schemaCheck("output_schema", null, spec.task.outputSchema, output, timeoutMs),
  ];
  for (const [index, evaluation] of spec.evaluations.entries()) {
    if (evaluation.taskId !== spec.task.id) continue;
    if (evaluation.kind === "schema") {
      checks.push(await schemaCheck("schema", index, evaluation.spec.schema, output, timeoutMs));
    } else if (evaluation.kind === "rubric") {
      checks.push({
        kind: "rubric",
        index,
        status: "needs_judgement",
        criteria: evaluation.spec.criteria.map((criterion) => criterion.id),
        passingScore: evaluation.spec.passingScore,
      });
    } else {
      checks.push({ kind: "script", index, status: "not_run", reason: scriptNotRunReason });
    }
  }
  const failed = checks.some((check) => check.status === "failed");
  return { outcome: failed ? "failed" : "passed", checks };
}
