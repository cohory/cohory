import type { Session } from "@cohory/auth";
import { getCommunitiesService } from "@cohory/communities";
import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { emailConfigProblem, getEmailOutbox } from "@cohory/email";
import { logger } from "@cohory/infra/logger";
import {
  createContactService,
  type ContactAccount,
  type ContactService,
} from "@cohory/notifications/contact";
import { getRateLimiter } from "@cohory/rate-limit";
import { z } from "zod";

import { actorFor } from "../actor";

const secretSchema = z.string().min(32);

let service: ContactService | undefined;

// The form is only offered when a message can really leave the server: an address to send it
// to and an email setup that parses.
export function getContactService(): ContactService {
  if (!service) {
    const { edition, appUrl } = getPlatformConfig();
    const contactEmail = getLegalConfig().contactEmail;
    service = createContactService({
      outbox: getEmailOutbox(),
      limiter: getRateLimiter(),
      secret: secretSchema.parse(process.env.BETTER_AUTH_SECRET),
      contactEmail: contactEmail && emailConfigProblem() === null ? contactEmail : null,
      edition,
      instanceUrl: appUrl,
      log: (entry) => logger.info({ ...entry }, "contact form"),
    });
  }
  return service;
}

export async function contactAccount(session: Session): Promise<ContactAccount> {
  const rows = await getCommunitiesService().listCommunitiesForUser(actorFor(session));
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    createdAt: new Date(session.user.createdAt),
    communities: rows.map(({ community, membership }) => ({
      name: community.name,
      slug: community.slug,
      role:
        membership.status === "active"
          ? membership.role
          : `${membership.role}, ${membership.status}`,
    })),
  };
}
