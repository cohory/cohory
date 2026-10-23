import { z } from "zod";

import type {
  CatalogEntry,
  DescribedError,
  ErrorAudience,
  ErrorIssue,
  ErrorMatcher,
} from "./types";

export const validationMessage = "Some fields are not valid. Check them and try again.";

function text<E>(value: string | ((error: E) => string), error: E): string {
  return typeof value === "string" ? value : value(error);
}

export function describeWith<E>(
  entry: CatalogEntry<E>,
  code: string,
  error: E,
  audience?: ErrorAudience,
): DescribedError {
  const issues = entry.issues?.(error);
  const details = entry.details ? entry.details(error) : issues;
  const retryAfterSeconds = entry.retryAfterSeconds?.(error);
  return {
    kind: entry.kind,
    code,
    message: text((audience ? entry[audience] : undefined) ?? entry.message, error),
    ...(details !== undefined ? { details } : {}),
    ...(issues !== undefined ? { issues } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

export function fromCatalog<E extends Error & { readonly code: string }>(
  base: abstract new (...args: never[]) => E,
  catalog: NoInfer<Partial<Record<E["code"], CatalogEntry<E>>>>,
): ErrorMatcher {
  return (error, audience) => {
    if (!(error instanceof base)) return null;
    const found: E = error;
    const code: E["code"] = found.code;
    const entry: CatalogEntry<E> | undefined = catalog[code];
    return entry ? describeWith(entry, code, found, audience) : null;
  };
}

export function fromClass<E extends Error>(
  base: abstract new (...args: never[]) => E,
  code: string,
  entry: CatalogEntry<E>,
  when: (error: E) => boolean = () => true,
): ErrorMatcher {
  return (error, audience) =>
    error instanceof base && when(error) ? describeWith(entry, code, error, audience) : null;
}

const issuesSchema = z.array(z.object({ path: z.string(), message: z.string() }));

export function validationIssues(error: unknown): readonly ErrorIssue[] | null {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "validation_failed") {
    return null;
  }
  if (!("issues" in error)) return null;
  const parsed = issuesSchema.safeParse(error.issues);
  return parsed.success ? parsed.data : null;
}

export const moduleValidation: ErrorMatcher = (error) => {
  const issues = validationIssues(error);
  return issues
    ? {
        kind: "validation",
        code: "validation_failed",
        message: validationMessage,
        details: issues,
        issues,
      }
    : null;
};
