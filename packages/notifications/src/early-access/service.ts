import type { EmailOutbox } from "@cohory/email";
import type { RateLimiter } from "@cohory/rate-limit";
import { z } from "zod";

import {
  createPublicFormGuard,
  formTokenField,
  honeypotField,
  replyToEmail,
  type PublicFormLimit,
  type PublicFormScreen,
} from "../public-form";

export const earlyAccessPlatforms = ["Skool", "Circle", "Other", "None"] as const;
export const earlyAccessMemberCounts = ["None", "1 to 50", "51 to 500", "More than 500"] as const;
export const earlyAccessNoteMax = 1000;

export type EarlyAccessPlatform = (typeof earlyAccessPlatforms)[number];
export type EarlyAccessMemberCount = (typeof earlyAccessMemberCounts)[number];

const earlyAccessFormSchema = z.object({
  email: replyToEmail,
  platform: z.enum(earlyAccessPlatforms, { error: "Choose the platform you use today." }),
  members: z.enum(earlyAccessMemberCounts, {
    error: "Choose how many paying members you have.",
  }),
  note: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(earlyAccessNoteMax, "Keep it under 1000 characters.").nullable(),
  ),
  website: honeypotField,
  token: formTokenField,
});

export type EarlyAccessField = "email" | "platform" | "members" | "note";

export interface EarlyAccessAccount {
  readonly id: string;
  readonly email: string;
}

export interface EarlyAccessSubmission {
  readonly form: Readonly<Record<string, unknown>>;
  readonly ip: string;
  readonly account: EarlyAccessAccount | null;
}

// Everything but a typing mistake answers "accepted", so the form cannot be used to learn
// whether a request was sent, dropped as spam, or rate limited.
export type EarlyAccessResult =
  | { readonly status: "accepted" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "invalid";
      readonly field: EarlyAccessField;
      readonly message: string;
    };

export type EarlyAccessOutcomeCode =
  "sent" | "invalid" | "unavailable" | Exclude<PublicFormScreen, "ok">;

export interface EarlyAccessLogEntry {
  readonly outcome: EarlyAccessOutcomeCode;
  readonly signedIn: boolean;
}

export interface EarlyAccessServiceDeps {
  readonly outbox: Pick<EmailOutbox, "send">;
  readonly limiter: Pick<RateLimiter, "check" | "consume">;
  readonly secret: string;
  readonly contactEmail: string | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly now?: () => Date;
  readonly log?: (entry: EarlyAccessLogEntry) => void;
}

export interface EarlyAccessService {
  readonly available: boolean;
  issueFormToken(): string;
  submit(submission: EarlyAccessSubmission): Promise<EarlyAccessResult>;
}

const fields = new Set<string>(["email", "platform", "members", "note"]);

function isField(value: PropertyKey | undefined): value is EarlyAccessField {
  return typeof value === "string" && fields.has(value);
}

export function createEarlyAccessService(deps: EarlyAccessServiceDeps): EarlyAccessService {
  const guard = createPublicFormGuard({
    limiter: deps.limiter,
    secret: deps.secret,
    purpose: "cohory.early-access",
    ...(deps.now ? { now: deps.now } : {}),
  });
  const log = deps.log ?? (() => undefined);
  const contactEmail = deps.edition === "cloud" ? deps.contactEmail : null;

  return {
    available: contactEmail !== null,

    issueFormToken() {
      return guard.issueToken();
    },

    async submit({ form, ip, account }) {
      const signedIn = account !== null;
      if (!contactEmail) {
        log({ outcome: "unavailable", signedIn });
        return { status: "unavailable" };
      }
      const parsed = earlyAccessFormSchema.safeParse(form);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((candidate) => isField(candidate.path[0]));
        log({ outcome: "invalid", signedIn });
        const field = issue?.path[0];
        return isField(field) && issue
          ? { status: "invalid", field, message: issue.message }
          : { status: "accepted" };
      }
      const input = parsed.data;
      const limits: PublicFormLimit[] = [
        ["contactIpHour", `early-access:ip:${ip}`],
        ["contactIpDay", `early-access:ip:${ip}`],
        ...(account ? [["contactAccount", `early-access:user:${account.id}`] as const] : []),
      ];
      const screen = guard.screen({ honeypot: input.website, token: input.token, limits });
      if (screen !== "ok") {
        log({ outcome: screen, signedIn });
        return { status: "accepted" };
      }
      await deps.outbox.send({
        template: "early-access-request",
        to: contactEmail,
        data: {
          email: input.email,
          platform: input.platform,
          members: input.members,
          note: input.note,
          account: account ? { id: account.id, email: account.email } : null,
          edition: deps.edition,
          instanceUrl: deps.instanceUrl,
          ipHash: guard.hashIp(ip),
          sentAt: guard.now().toISOString(),
        },
      });
      log({ outcome: "sent", signedIn });
      return { status: "accepted" };
    },
  };
}
