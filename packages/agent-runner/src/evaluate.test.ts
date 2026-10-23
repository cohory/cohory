import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { evaluateTask, scriptNotRunReason, type TaskSpec } from "./evaluate";

const marker = join(tmpdir(), `cohory-runner-pwned-${process.pid}`);

const spec: TaskSpec = {
  task: {
    id: "write-checklist",
    outputSchema: { type: "object", required: ["items"] },
  },
  evaluations: [
    {
      taskId: "write-checklist",
      kind: "schema",
      spec: { schema: { type: "object", properties: { items: { minItems: 2 } } } },
    },
    {
      taskId: "write-checklist",
      kind: "rubric",
      spec: { criteria: [{ id: "rollback", points: 5 }], passingScore: 3 },
    },
    {
      taskId: "write-checklist",
      kind: "script",
      spec: {
        language: "javascript",
        source: `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`,
      },
    },
    { taskId: "other-task", kind: "schema", spec: { schema: false } },
  ],
};

describe("evaluateTask", () => {
  it("passes when the output matches the output schema and every schema evaluation", async () => {
    const report = await evaluateTask(spec, { items: ["test", "roll back"] });
    expect(report.outcome).toBe("passed");
    expect(report.checks.map((check) => [check.kind, check.status])).toEqual([
      ["output_schema", "passed"],
      ["schema", "passed"],
      ["rubric", "needs_judgement"],
      ["script", "not_run"],
    ]);
  });

  it("fails with readable errors when a schema check fails", async () => {
    const report = await evaluateTask(spec, { items: ["only one"] });
    expect(report.outcome).toBe("failed");
    expect(report.checks[1]).toMatchObject({
      status: "failed",
      errors: [expect.stringContaining("/items")],
    });
    expect((await evaluateTask(spec, "not an object")).checks[0]).toMatchObject({
      status: "failed",
    });
  });

  it("never runs script evaluations", async () => {
    const report = await evaluateTask(spec, { items: ["a", "b"] });
    expect(report.checks.find((check) => check.kind === "script")).toMatchObject({
      reason: scriptNotRunReason,
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("treats a broken schema as a failed check instead of throwing", async () => {
    const report = await evaluateTask(
      { task: { id: "t", outputSchema: { type: "nope" } }, evaluations: [] },
      {},
    );
    expect(report.outcome).toBe("failed");
  });

  it("never fetches a schema that points outside itself and fails the check instead", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const report = await evaluateTask(
      {
        task: { id: "t", outputSchema: { $ref: "https://attacker.example/schema.json" } },
        evaluations: [
          { taskId: "t", kind: "schema", spec: { schema: { $ref: "file:///etc/passwd" } } },
        ],
      },
      {},
    );
    expect(report.outcome).toBe("failed");
    expect(report.checks.map((check) => check.status)).toEqual(["failed", "failed"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not let hostile schema keywords change shared objects or run code", async () => {
    const hostile = JSON.parse(
      `{"type":"object","properties":{"__proto__":{"polluted":true}},"default":"x\u0027);require(\u0027child_process\u0027).execSync(\u0027touch ${marker}\u0027);//"}`,
    ) as unknown;
    await evaluateTask({ task: { id: "t", outputSchema: hostile }, evaluations: [] }, { a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });

  it("fails a check whose pattern could backtrack for a very long time without running it", async () => {
    const report = await evaluateTask(
      {
        task: {
          id: "t",
          outputSchema: { type: "object", properties: { name: { pattern: "^(a+)+$" } } },
        },
        evaluations: [],
      },
      { name: `${"a".repeat(40)}!` },
    );
    expect(report.outcome).toBe("failed");
    expect(report.checks[0]).toMatchObject({
      status: "failed",
      errors: [expect.stringContaining("repeats a group that already repeats")],
    });
  });

  it("stops a check that runs longer than the time limit and fails it", async () => {
    const slow = {
      type: "array",
      items: { type: "string", pattern: "^[a-z]+[a-z]+[a-z]+[a-z]+[a-z]+[a-z]+[a-z]+[a-z]+@$" },
    };
    const output = Array.from({ length: 50 }, () => "a".repeat(400));
    const started = Date.now();
    const report = await evaluateTask(
      { task: { id: "t", outputSchema: slow }, evaluations: [] },
      output,
      { timeoutMs: 200 },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(report.checks[0]).toMatchObject({
      status: "failed",
      errors: ["The check took longer than 200 ms and was stopped."],
    });
  });
});
