import { actionFailure } from "../posts/errors";

export function reviewsActionFailure(error: unknown): { ok: false; message: string } | null {
  return actionFailure(error);
}
