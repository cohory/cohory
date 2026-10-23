import type { z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import { errorResponse } from "./posts-schemas";

export const jsonLimit = bodyLimit({ maxSize: 64 * 1024 });

export const security = [{ sessionCookie: [] }];
export const tags = ["Manage"];
export const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to do this in the community."),
  404: errorResponse("The community or member does not exist or is not visible to the caller."),
  422: errorResponse("The input is invalid."),
};
export const conflict = errorResponse("The community is archived, or must be archived first.");
export const managers = " Admins and owners only.";
export const staff = " Moderators, admins, and owners.";
export const ownerOnly = " Owner only.";
export const manageBase = "/communities/{slug}/manage";

export function jsonBody<T extends z.ZodType>(schema: T, required = true) {
  return { body: { required, content: { "application/json": { schema } } } };
}
