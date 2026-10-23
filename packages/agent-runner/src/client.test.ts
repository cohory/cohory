import { describe, expect, it } from "vitest";

import { createRunnerClient, RunnerError } from "./client";
import { runTask } from "./run";

const ref = {
  courseId: "0190a000-0000-7000-8000-000000000002",
  lessonId: "0190a000-0000-7000-8000-000000000003",
  taskId: "write-checklist",
  version: "1.0.0",
};

function fakeApi() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/tasks/")) {
      return Response.json({
        version: "1.0.0",
        checksum: "abc",
        task: { id: "write-checklist", outputSchema: { type: "object", required: ["items"] } },
        evaluations: [
          {
            taskId: "write-checklist",
            kind: "script",
            spec: { language: "sh", source: "rm -rf /" },
          },
        ],
      });
    }
    return Response.json({ id: "s1", label: "self_reported" }, { status: 201 });
  };
  return { calls, fetch };
}

describe("runner client", () => {
  it("fetches the task, checks the output locally, and submits a self reported result with its environment", async () => {
    const api = fakeApi();
    const result = await runTask({
      baseUrl: "https://cohory.example",
      community: "makers",
      token: "cohory_agent_x",
      ...ref,
      output: { items: ["a"] },
      runId: "run-1",
      environment: { model: "local" },
      fetch: api.fetch,
    });
    expect(result.report.outcome).toBe("passed");
    expect(api.calls.map((call) => new URL(call.url).origin)).toEqual([
      "https://cohory.example",
      "https://cohory.example",
    ]);
    const body = JSON.parse(String(api.calls[1]?.init.body)) as {
      runId: string;
      version: string;
      payload: { environment: Record<string, string>; checks: { status: string }[] };
    };
    expect(body).toMatchObject({ runId: "run-1", version: "1.0.0" });
    expect(body.payload.environment).toMatchObject({
      runner: "@cohory/agent-runner",
      model: "local",
    });
    expect(body.payload.checks.map((check) => check.status)).toEqual(["passed", "not_run"]);
    expect(api.calls[0]?.init.redirect).toBe("error");
  });

  it("refuses to call anything but the configured cohory origin", async () => {
    const api = fakeApi();
    const client = createRunnerClient({
      baseUrl: "https://cohory.example",
      community: "//evil.example/x",
      token: "t",
      fetch: api.fetch,
    });
    await expect(client.getTask(ref)).resolves.toBeDefined();
    expect(api.calls.every((call) => new URL(call.url).origin === "https://cohory.example")).toBe(
      true,
    );
  });

  it("surfaces API errors with their code", async () => {
    const client = createRunnerClient({
      baseUrl: "https://cohory.example",
      community: "makers",
      token: "t",
      fetch: async () =>
        Response.json(
          { error: { code: "delegation_required", message: "Ask your person." } },
          { status: 403 },
        ),
    });
    await expect(client.getTask(ref)).rejects.toEqual(
      new RunnerError(403, "delegation_required", "Ask your person."),
    );
  });
});
