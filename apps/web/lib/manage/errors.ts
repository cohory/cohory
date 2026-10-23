import { actionFailure } from "../posts/errors";

export function manageActionFailure(error: unknown): { ok: false; message: string } | null {
  return actionFailure(error, "creator");
}
