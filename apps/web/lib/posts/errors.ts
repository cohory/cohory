import {
  archivedForMembersMessage,
  describeError,
  forbiddenMessage,
  rateLimitMessage,
  type ErrorAudience,
} from "@cohory/api/errors";
import { z } from "zod";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export class CommunityUnavailableError extends Error {
  constructor() {
    super("community is not available to the actor");
    this.name = "CommunityUnavailableError";
  }
}

export const archivedMessage = archivedForMembersMessage;

export { rateLimitMessage };

const checkInput = "Check what you entered and try again.";

export function failure(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

export function actionFailure(
  error: unknown,
  audience: ErrorAudience = "member",
): { ok: false; message: string } | null {
  if (error instanceof z.ZodError) {
    return failure(error.issues[0]?.message ?? checkInput);
  }
  if (error instanceof CommunityUnavailableError) {
    return failure(forbiddenMessage);
  }
  const described = describeError(error, audience);
  if (!described) {
    return null;
  }
  return failure(described.issues?.[0]?.message ?? described.message);
}
