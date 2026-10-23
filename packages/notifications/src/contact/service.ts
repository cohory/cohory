import type { EmailOutbox } from "@cohory/email";
import type { RateLimiter } from "@cohory/rate-limit";
import { z } from "zod";

import {
  createPublicFormGuard,
  formTokenField,
  honeypotField,
  replyToEmail,
  singleLine,
  type PublicFormLimit,
} from "../public-form";

export const contactTopics = [
  "Feedback",
  "Help with my community",
  "Billing",
  "Report a problem",
  "Other",
] as const;

export type ContactTopic = (typeof contactTopics)[number];

export const contactMessageLimits = { min: 10, max: 5000 } as const;
export const contactLinkLimits = { signedOut: 3, signedIn: 10 } as const;
export const contactAccountCommunityCap = 20;

const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(100, "Keep your name under 100 characters.")
    .regex(singleLine, "Use a name on one line."),
  email: replyToEmail,
  topic: z.enum(contactTopics, { error: "Choose a topic." }),
  message: z
    .string()
    .trim()
    .min(contactMessageLimits.min, "Write at least 10 characters.")
    .max(contactMessageLimits.max, "Keep the message under 5000 characters."),
  link: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .url({ protocol: /^https?$/, error: "Paste a full link that starts with https." })
      .max(2000, "Use a shorter link.")
      .nullable(),
  ),
  website: honeypotField,
  token: formTokenField,
});

export type ContactFormInput = z.input<typeof contactFormSchema>;

export interface ContactCommunity {
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export interface ContactAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly communities: readonly ContactCommunity[];
}

export interface ContactSubmission {
  readonly form: Readonly<Record<string, unknown>>;
  readonly ip: string;
  readonly account: ContactAccount | null;
}

export type ContactRejection =
  | "unavailable"
  | "invalid"
  | "too_fast"
  | "expired"
  | "bad_token"
  | "rate_limited"
  | "too_many_links";

export type ContactOutcomeCode = "sent" | "honeypot" | ContactRejection;

export type ContactResult =
  | { readonly status: "sent" }
  | { readonly status: "rejected"; readonly code: ContactRejection; readonly message: string };

export interface ContactLogEntry {
  readonly outcome: ContactOutcomeCode;
  readonly signedIn: boolean;
  readonly links: number;
}

export interface ContactServiceDeps {
  readonly outbox: Pick<EmailOutbox, "send">;
  readonly limiter: Pick<RateLimiter, "check" | "consume">;
  readonly secret: string;
  readonly contactEmail: string | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly now?: () => Date;
  readonly log?: (entry: ContactLogEntry) => void;
}

export interface ContactService {
  readonly available: boolean;
  issueFormToken(): string;
  submit(submission: ContactSubmission): Promise<ContactResult>;
}

const rejectionMessages: Record<ContactRejection, string> = {
  invalid: "Check the form and try again.",
  unavailable: "This server does not take messages yet.",
  too_fast: "That was quick. Wait a few seconds, then send it again.",
  expired: "This form expired. Send it again.",
  bad_token: "This form expired. Send it again.",
  rate_limited: "You sent several messages already. Try again later.",
  too_many_links: "Use fewer links in the message.",
};

export function countLinks(text: string): number {
  return text.match(/(?:https?:\/\/|www\.)\S+/gi)?.length ?? 0;
}

export function createContactService(deps: ContactServiceDeps): ContactService {
  const guard = createPublicFormGuard({
    limiter: deps.limiter,
    secret: deps.secret,
    purpose: "cohory.contact",
    ...(deps.now ? { now: deps.now } : {}),
  });
  const log = deps.log ?? (() => undefined);

  function reject(
    code: ContactRejection,
    signedIn: boolean,
    links: number,
    message = rejectionMessages[code],
  ): ContactResult {
    log({ outcome: code, signedIn, links });
    return { status: "rejected", code, message };
  }

  return {
    available: deps.contactEmail !== null,

    issueFormToken() {
      return guard.issueToken();
    },

    async submit({ form, ip, account }) {
      const signedIn = account !== null;
      const contactEmail = deps.contactEmail;
      if (!contactEmail) {
        return reject("unavailable", signedIn, 0);
      }
      const parsed = contactFormSchema.safeParse(
        account ? { ...form, name: account.name, email: account.email } : form,
      );
      if (!parsed.success) {
        return reject("invalid", signedIn, 0, parsed.error.issues[0]?.message);
      }
      const input = parsed.data;
      const links = countLinks(input.message);
      const limits: PublicFormLimit[] = [
        ["contactIpHour", `contact:ip:${ip}`],
        ["contactIpDay", `contact:ip:${ip}`],
        ...(account ? [["contactAccount", `contact:user:${account.id}`] as const] : []),
      ];
      const screen = guard.screen({ honeypot: input.website, token: input.token, limits });
      if (screen === "honeypot") {
        log({ outcome: "honeypot", signedIn, links });
        return { status: "sent" };
      }
      if (screen !== "ok") {
        return reject(screen, signedIn, links);
      }
      const at = guard.now();
      const maxLinks = signedIn ? contactLinkLimits.signedIn : contactLinkLimits.signedOut;
      if (links > maxLinks) {
        return reject(
          "too_many_links",
          signedIn,
          links,
          `Use at most ${maxLinks} links in the message.`,
        );
      }
      await deps.outbox.send({
        template: "contact-message",
        to: contactEmail,
        data: {
          topic: input.topic,
          name: input.name,
          email: input.email,
          message: input.message,
          link: input.link,
          account: account
            ? {
                id: account.id,
                name: account.name,
                email: account.email,
                emailVerified: account.emailVerified,
                createdAt: account.createdAt.toISOString(),
                communities: account.communities
                  .slice(0, contactAccountCommunityCap)
                  .map(({ name, slug, role }) => ({ name, slug, role })),
                moreCommunities: Math.max(
                  0,
                  account.communities.length - contactAccountCommunityCap,
                ),
              }
            : null,
          edition: deps.edition,
          instanceUrl: deps.instanceUrl,
          ipHash: guard.hashIp(ip),
          sentAt: at.toISOString(),
        },
      });
      log({ outcome: "sent", signedIn, links });
      return { status: "sent" };
    },
  };
}
