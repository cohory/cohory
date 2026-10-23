import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { describeError, kindStatus, validationMessage } from "./error-catalog";

export { agentNotAllowedMessage } from "./error-catalog";

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("Error");

export type ErrorStatus = (typeof kindStatus)[keyof typeof kindStatus] | 500;

export interface ApiError {
  status: ErrorStatus;
  code: string;
  message: string;
  details?: unknown;
  retryAfterSeconds?: number;
}

const internalError: ApiError = {
  status: 500,
  code: "internal_error",
  message: "Something went wrong. Try again.",
};

export function validationError(details: unknown): ApiError {
  return { status: 422, code: "validation_failed", message: validationMessage, details };
}

const httpStatuses: Partial<Record<number, ApiError>> = {
  401: { status: 401, code: "unauthenticated", message: "Sign in to continue." },
  403: { status: 403, code: "forbidden", message: "You do not have permission to do that." },
  404: { status: 404, code: "not_found", message: "We could not find that page." },
  413: { status: 413, code: "payload_too_large", message: "The request is too large." },
};

function httpExceptionError(error: HTTPException): ApiError {
  if (error.status === 400) {
    return validationError([{ path: "", message: error.message }]);
  }
  return httpStatuses[error.status] ?? internalError;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof HTTPException) {
    return httpExceptionError(error);
  }
  const described = describeError(error);
  if (!described) {
    return internalError;
  }
  return {
    status: kindStatus[described.kind],
    code: described.code,
    message: described.message,
    ...(described.details !== undefined ? { details: described.details } : {}),
    ...(described.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: described.retryAfterSeconds }
      : {}),
  };
}

export function errorJson(c: Context, error: ApiError): Response {
  const body = { error: { code: error.code, message: error.message, details: error.details } };
  if (error.retryAfterSeconds !== undefined) {
    c.header("Retry-After", String(Math.max(1, error.retryAfterSeconds)));
  }
  return c.json(body, error.status);
}
