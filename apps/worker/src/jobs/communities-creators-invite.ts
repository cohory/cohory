import {
  createDefaultCreatorsInviteService,
  type CreatorsInviteMessage,
  type CreatorsInviteService,
} from "@cohory/communities/creators-invite";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  createOptOutLinker,
  creatorsInviteEmail,
  getSuppressionList,
  hashEmailAddress,
  optOutSecretFromEnv,
  sendEmail,
  type EmailMessage,
} from "@cohory/email";
import { creatorsInviteJob, creatorsInviteJobPayloadSchema } from "@cohory/events";
import type { Job } from "pg-boss";

import type { Logger } from "../logger";
import type { JobDefinition } from "./definition";

export const COMMUNITIES_CREATORS_INVITE = creatorsInviteJob;

export type InviteCreator = CreatorsInviteService["inviteCreator"];

export function creatorsInviteMessage(
  message: CreatorsInviteMessage,
  optOut: { url: string; headers: Record<string, string> },
): EmailMessage {
  return {
    to: message.to,
    communityId: message.community.id,
    headers: optOut.headers,
    ...creatorsInviteEmail({
      name: message.name,
      communityName: message.community.name,
      inviterName: message.inviterName,
      url: message.url,
      expiresAt: message.expiresAt,
      optOutUrl: optOut.url,
    }),
  };
}

export function defaultInviteCreator(appUrl: string): InviteCreator {
  let service: CreatorsInviteService | undefined;
  return (input) => {
    if (!service) {
      const secret = optOutSecretFromEnv();
      const optOut = createOptOutLinker({ secret, appUrl });
      const suppression = getSuppressionList();
      service = createDefaultCreatorsInviteService({
        creatorsSlug: getPlatformConfig().creatorsCommunity,
        secret,
        appUrl,
        isOptedOut: (email, communityId) =>
          suppression.isSuppressed({ addressHash: hashEmailAddress(email), communityId }),
        send: (message) =>
          sendEmail(
            creatorsInviteMessage(
              message,
              optOut({ to: message.to, communityId: message.community.id }),
            ),
          ),
      });
    }
    return service.inviteCreator(input);
  };
}

export function createCreatorsInviteHandler(logger: Logger, inviteCreator: InviteCreator) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const input = creatorsInviteJobPayloadSchema.parse(job.data);
      const outcome = await inviteCreator(input);
      logger.info(
        {
          jobId: job.id,
          job: job.name,
          communityId: input.communityId,
          trigger: input.trigger,
          outcome,
        },
        "creators invite",
      );
    }
  };
}

export const creatorsInviteJobDefinition: JobDefinition = {
  name: COMMUNITIES_CREATORS_INVITE,
  queueOptions: { retryLimit: 5, retryBackoff: true },
  payloadSchema: creatorsInviteJobPayloadSchema,
  handler: ({ logger, deps }) => createCreatorsInviteHandler(logger, deps.inviteCreator),
};
