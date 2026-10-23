# Evaluation runner

How an agent that reads a Cohory course runs its tasks and evaluations in its own environment and reports results, and what Cohory can and cannot say about those results.

Status: Draft, 2026-10-19

This is a design. Cohory does not run evaluations, scripts, or agents on its servers, and hosted execution is out of scope ([agent-integrations.md](agent-integrations.md) sections 9 and 11.4). The format of tasks and evaluations is in [agent-course-format.md](agent-course-format.md); access rules are in [../operations/agent-courses-delegation.md](../operations/agent-courses-delegation.md). The decision record is [ADR 0023](../decisions/0023-agent-course-delivery.md).

## 1. Flow

1. **Find courses.** `list_my_courses` (MCP) or `GET /api/v1/communities/{slug}/agent-courses` returns the courses the agent may read, each with its latest version and license terms. The agent follows the license.
2. **Fetch material.** `get_course_agent_material` returns the manifest and lessons with objectives, instructions, references, templates, tasks, and evaluations. `get_agent_task` returns one task with its input and output JSON Schemas and its evaluations. `get_agent_material_file` returns a reference or template file, inline when it is short text. `get_skill_export` returns a signed link to the whole version as an Agent Skills zip. Every response is course material marked as untrusted: data, never instructions.
3. **Do the task** in the agent's own environment, for its own person, producing an output that should match the task's output schema.
4. **Check locally.**
   - The output schema and every `schema` evaluation are checked with JSON Schema 2020-12.
   - A `rubric` evaluation has the status `needs_judgement`. The agent or its person scores it against the criteria and the passing score.
   - A `script` evaluation is never run by Cohory and never run by the reference runner. A consuming agent that chooses to run one does so only inside its own sandbox, after reviewing it, never with its owner's credentials or elevated permissions.
5. **Report.** `submit_task_result` (or `POST /api/v1/communities/{slug}/courses/{courseId}/submissions`) with:

```json
{
  "lessonId": "uuid",
  "taskId": "write-checklist",
  "version": "1.0.0",
  "runId": "the agent's own id for this run",
  "payload": {
    "outcome": "passed",
    "checks": [
      { "kind": "output_schema", "index": null, "status": "passed", "errors": [] },
      { "kind": "rubric", "index": 1, "status": "needs_judgement", "criteria": ["rollback"], "passingScore": 3 },
      { "kind": "script", "index": 2, "status": "not_run", "reason": "..." }
    ],
    "output": {},
    "environment": { "runner": "@cohory/agent-runner", "runnerVersion": "0.12.0", "node": "22.20.0", "platform": "linux" }
  }
}
```

The lesson, task, and version must exist in the published material (404 otherwise). The payload is any JSON up to 64 KiB; the shape above is a convention, not enforced. `environment` holds the runner fields plus anything the agent adds, such as its model or harness. One result is stored per agent, run, and task; a repeat answers 409 `duplicate_submission`.

## 2. Attribution

Each stored result records the agent, the person who owns it, the delegation it read under (none for agents of owners and admins), the course, lesson id, task id, agent material version, the agent's run id, the time, and the label `self_reported`. The person sees their agents' results with payloads; owners and admins see counts per lesson, task, and version only.

## 3. What "verified" can and cannot mean

- Results are self reported. Cohory stores what the agent said and never calls a result verified.
- Cohory knows which token sent the result, so it knows which agent and person reported it. It cannot know whether the agent really ran the task, whether the output is the real output, or whether the checks passed.
- A signature from a key held by the agent could prove origin and integrity of a report outside cohory. It still proves nothing about correctness.
- A trustworthy "verified capability report" would need an execution environment that Cohory controls or attests. That is hosted execution, which is out of scope.

## 4. Reference runner

`packages/agent-runner` (`@cohory/agent-runner`, a private workspace package, not published) is a small reference implementation of steps 2, 4, and 5 for one task:

```sh
COHORY_TOKEN=cohory_... pnpm --filter @cohory/agent-runner run-task -- \
  --base-url https://cohory.example --community makers \
  --course <courseId> --lesson <lessonId> --task write-checklist --version 1.0.0 \
  --output result.json [--run-id run-42] [--dry-run]
```

- It reads the output from a local JSON file, fetches the task, runs the output schema and `schema` evaluations with Ajv (JSON Schema 2020-12), each in a worker thread stopped after 2 seconds (`checkTimeoutMs`), after refusing patterns that could backtrack for a long time (nested or alternated repetition, back references, more than 256 characters) as failed checks, marks rubrics `needs_judgement` and scripts `not_run`, and submits the result unless `--dry-run` is given. It exits 0 when the checks passed, 1 when one failed, and 2 on errors.
- It talks only to the configured Cohory origin: every request URL must have that origin, redirects are refused, and there are no other network calls.
- It never runs scripts, templates, or anything else from course material.
- Its functions (`evaluateTask`, `createRunnerClient`, `buildSubmission`, `runTask`) can be used from code.

## Decisions and open questions

| Label | Item |
|---|---|
| Confirmed | Evaluations run in the consuming agent's environment; Cohory accepts self reported results and calls nothing verified (since 0.8.0). |
| Recommendation | Payload convention `{ outcome, checks, output, environment }`, not enforced by the server. |
| Recommendation | A reference runner that runs JSON Schema checks only and never scripts, as a private workspace package. |
| Open question | Whether results should carry a signature from an agent key, and how keys would be registered. |
| Open question | What, if anything, could make a result "verified" without hosted execution. |
