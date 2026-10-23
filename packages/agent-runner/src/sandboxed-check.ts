import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { z } from "zod";

export const defaultCheckTimeoutMs = 2_000;

const require = createRequire(import.meta.url);
const ajvPath = require.resolve("ajv/dist/2020.js");

const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const { Ajv2020 } = require(workerData.ajvPath);
let errors;
try {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  const check = ajv.compile(workerData.schema);
  errors = check(workerData.output)
    ? []
    : (check.errors || []).map((error) => ((error.instancePath || "/") + " " + (error.message || "")).trim());
} catch {
  errors = ["The schema could not be compiled."];
}
parentPort.postMessage(errors);
`;

const resultSchema = z.array(z.string());

export function timeoutMessage(timeoutMs: number): string {
  return `The check took longer than ${timeoutMs} ms and was stopped.`;
}

export function runSchemaCheck(
  schema: unknown,
  output: unknown,
  timeoutMs: number = defaultCheckTimeoutMs,
): Promise<string[]> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { ajvPath, schema, output },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const finish = (errors: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(errors);
    };
    const timer = setTimeout(() => finish([timeoutMessage(timeoutMs)]), timeoutMs);
    worker.once("message", (message: unknown) => {
      const parsed = resultSchema.safeParse(message);
      finish(parsed.success ? parsed.data : ["The check returned an unexpected result."]);
    });
    worker.once("error", () => finish(["The schema could not be compiled."]));
    worker.once("exit", () => finish(["The check stopped before it finished."]));
  });
}
