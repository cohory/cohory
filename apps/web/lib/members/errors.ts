import { actionFailure } from "../posts/errors";

export function membersActionFailure(error: unknown): { ok: false; message: string } | null {
  return actionFailure(error);
}
