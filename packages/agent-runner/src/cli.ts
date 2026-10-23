#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { runTask } from "./run";

const usage =
  "Usage: COHORY_TOKEN=... cohory-agent-runner --base-url https://cohory.example --community slug --course <courseId> --lesson <lessonId> --task <taskId> --version 1.0.0 --output result.json [--run-id id] [--dry-run]";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      community: { type: "string" },
      course: { type: "string" },
      lesson: { type: "string" },
      task: { type: "string" },
      version: { type: "string" },
      output: { type: "string" },
      "run-id": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const token = process.env.COHORY_TOKEN;
  const required = [
    values["base-url"],
    values.community,
    values.course,
    values.lesson,
    values.task,
    values.version,
    values.output,
  ];
  if (!token || required.some((value) => !value)) {
    console.error(usage);
    return 2;
  }
  const output: unknown = JSON.parse(await readFile(values.output ?? "", "utf8"));
  const result = await runTask({
    baseUrl: values["base-url"] ?? "",
    community: values.community ?? "",
    token,
    courseId: values.course ?? "",
    lessonId: values.lesson ?? "",
    taskId: values.task ?? "",
    version: values.version ?? "",
    output,
    ...(values["run-id"] ? { runId: values["run-id"] } : {}),
    submit: !values["dry-run"],
  });
  console.log(JSON.stringify(result, null, 2));
  return result.report.outcome === "passed" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "The runner failed.");
    process.exit(2);
  },
);
