import { logger } from "@cohory/infra/logger";

import { actionFailure } from "./errors";

export const MEMBER_EMAIL_FAILED =
  "Your post is up, but the email to members did not go out. You can try again later.";

interface MemberEmailIds {
  readonly communityId: string;
  readonly postId: string;
}

type Log = (message: string, details: Record<string, string>) => void;

export async function emailMembersSafely(
  send: () => Promise<unknown>,
  ids: MemberEmailIds,
  log: Log = (message, details) => logger.error(details, message),
): Promise<string | null> {
  try {
    await send();
    return null;
  } catch (error: unknown) {
    const failure = actionFailure(error);
    if (failure) return failure.message;
    log("member email failed", {
      ...ids,
      error: error instanceof Error ? error.name : "unknown",
    });
    return MEMBER_EMAIL_FAILED;
  }
}
