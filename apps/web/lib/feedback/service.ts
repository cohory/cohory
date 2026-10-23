import type { Actor } from "@cohory/authz";
import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { getDb } from "@cohory/db";
import { emailConfigProblem, getEmailOutbox } from "@cohory/email";
import { logger } from "@cohory/infra/logger";
import {
  createCreatorFeedbackService,
  createPostgresCreatorFeedbackStore,
  type CreatorFeedbackService,
  type ExitReasonInput,
} from "@cohory/notifications/creator-feedback";
import type { z } from "zod";

import type { exitAnswerSchema } from "./exit-reasons";

let service: CreatorFeedbackService | undefined;

export function getCreatorFeedbackService(): CreatorFeedbackService {
  if (!service) {
    const { edition, appUrl } = getPlatformConfig();
    const contactEmail = getLegalConfig().contactEmail;
    service = createCreatorFeedbackService({
      store: createPostgresCreatorFeedbackStore(getDb()),
      outbox: getEmailOutbox(),
      contactEmail: contactEmail && emailConfigProblem() === null ? contactEmail : null,
      edition,
      instanceUrl: appUrl,
    });
  }
  return service;
}

export function asksWhyCreatorsLeave(): boolean {
  return getPlatformConfig().edition === "cloud";
}

// The reason never blocks the action it explains, so a failure here is logged and dropped.
export async function recordExitQuietly(
  actor: Actor,
  input: Omit<ExitReasonInput, "reason" | "comment">,
  answer: z.output<typeof exitAnswerSchema>,
): Promise<void> {
  if (!answer) {
    return;
  }
  try {
    await getCreatorFeedbackService().recordExit(actor, {
      ...input,
      reason: answer.reason,
      comment: answer.comment,
    });
  } catch (error: unknown) {
    logger.warn(
      { action: input.action, name: error instanceof Error ? error.name : "unknown" },
      "exit reason not recorded",
    );
  }
}
