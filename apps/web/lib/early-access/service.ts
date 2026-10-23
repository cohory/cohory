import { getLegalConfig } from "@cohory/config/legal";
import { canCreateCommunities, getPlatformConfig } from "@cohory/config/platform";
import { emailConfigProblem, getEmailOutbox } from "@cohory/email";
import { logger } from "@cohory/infra/logger";
import {
  createEarlyAccessService,
  type EarlyAccessService,
} from "@cohory/notifications/early-access";
import { getRateLimiter } from "@cohory/rate-limit";
import { z } from "zod";

export const earlyAccessHref = "/early-access";

const secretSchema = z.string().min(32);

let service: EarlyAccessService | undefined;

export function getEarlyAccessService(): EarlyAccessService {
  if (!service) {
    const { edition, appUrl } = getPlatformConfig();
    const contactEmail = getLegalConfig().contactEmail;
    service = createEarlyAccessService({
      outbox: getEmailOutbox(),
      limiter: getRateLimiter(),
      secret: secretSchema.parse(process.env.BETTER_AUTH_SECRET),
      contactEmail: contactEmail && emailConfigProblem() === null ? contactEmail : null,
      edition,
      instanceUrl: appUrl,
      log: (entry) => logger.info({ ...entry }, "early access form"),
    });
  }
  return service;
}

// A signed in person who may not create a community gets a quiet way to ask for it.
export function earlyAccessLinkFor(email: string): string | null {
  const { communityCreation } = getPlatformConfig();
  if (canCreateCommunities(communityCreation, email)) {
    return null;
  }
  return getEarlyAccessService().available ? earlyAccessHref : null;
}
