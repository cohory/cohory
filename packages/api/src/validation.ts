import type { z } from "@hono/zod-openapi";

export interface ValidationIssueJson {
  path: string;
  message: string;
}

export function issuesOf(error: z.ZodError): ValidationIssueJson[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
