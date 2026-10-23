import type { Job, Queue, WorkOptions } from "pg-boss";
import type { z } from "zod";

import type { Logger } from "../logger";
import type { JobDeps } from "../services";

export interface JobRunOptions {
  readonly fanoutPollSeconds: number;
}

export interface JobContext {
  readonly logger: Logger;
  readonly deps: JobDeps;
  readonly options: JobRunOptions;
}

export type JobHandler = (jobs: Job<unknown>[]) => Promise<void>;

/**
 * One queue the worker runs. A job sent by a domain package names that package's payload schema;
 * a job that only runs on a schedule has a cron and no payload.
 */
export type JobDefinition = {
  readonly name: string;
  readonly queueOptions?: Omit<Queue, "name">;
  readonly workOptions?: (options: JobRunOptions) => WorkOptions;
  readonly handler: (context: JobContext) => JobHandler;
} & (
  | { readonly cron: string; readonly payloadSchema?: undefined }
  | { readonly cron?: undefined; readonly payloadSchema: z.ZodType }
);
