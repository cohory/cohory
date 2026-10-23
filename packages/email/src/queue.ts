import { z } from "zod";

import { emailErrorCode } from "./log";
import { emailMessageSchema, type EmailContent, type EmailMessage, type Mailer } from "./message";
import {
  changeEmailConfirmationEmail,
  changeEmailVerificationEmail,
} from "./templates/change-email";
import { compInvitationEmail } from "./templates/comp-invitation";
import { contactMessageEmail } from "./templates/contact";
import { creatorFeedbackEmail } from "./templates/creator-feedback";
import { earlyAccessRequestEmail } from "./templates/early-access";
import { emailVerificationEmail } from "./templates/email-verification";
import { existingAccountSignUpEmail } from "./templates/existing-account-sign-up";
import {
  contentReportEmail,
  contentReportReceivedEmail,
  dataExportReadyEmail,
} from "./templates/legal";
import { magicLinkEmail } from "./templates/magic-link";
import { passwordChangedEmail } from "./templates/password-changed";
import { passwordRemovedEmail } from "./templates/password-removed";
import { passwordResetEmail } from "./templates/password-reset";
import { movingOfferEmail } from "./templates/moving-offer";
import { subscriptionMovedEmail } from "./templates/subscription-moved";

export const emailSendJob = "email.send";

// Jobs hold sign in links. The shortest one (a magic link) works for 15 minutes, so no job,
// waiting or finished, stays in the queue table longer than that.
const shortestLinkSeconds = 15 * 60;

export const emailSendQueueOptions = {
  retryLimit: 4,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 240,
  retentionSeconds: shortestLinkSeconds,
  deleteAfterSeconds: shortestLinkSeconds,
} as const;

type EmailSendQueueOptions = typeof emailSendQueueOptions;

const queueOptionKeys = [
  "retryLimit",
  "retryDelay",
  "retryBackoff",
  "retryDelayMax",
  "retentionSeconds",
  "deleteAfterSeconds",
] as const satisfies readonly (keyof EmailSendQueueOptions)[];

export type EmailQueueState = { readonly [K in keyof EmailSendQueueOptions]?: unknown };

const name = z.string().min(1).max(200);
const minutes = z.number().int().positive();
const headerSafeText = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}]*$/u);
const communityBrand = z
  .object({ logoUrl: z.string().nullish(), accent: z.string().nullish() })
  .optional();

function queued<T extends string, D extends z.ZodType>(template: T, data: D) {
  return z.object({
    template: z.literal(template),
    to: z.email(),
    communityId: z.uuid().optional(),
    headers: emailMessageSchema.shape.headers,
    data,
  });
}

export const queuedEmailSchema = z.discriminatedUnion("template", [
  queued("email-verification", z.object({ name, url: z.url(), expiresInMinutes: minutes })),
  queued("existing-account-sign-up", z.object({ name, signInUrl: z.url(), resetUrl: z.url() })),
  queued("password-reset", z.object({ name, url: z.url(), expiresInMinutes: minutes })),
  queued(
    "password-changed",
    z.object({
      name,
      changedAt: z.iso.datetime(),
      device: z.string().max(200).nullable(),
      resetUrl: z.url(),
    }),
  ),
  queued("magic-link", z.object({ url: z.url(), expiresInMinutes: minutes })),
  queued(
    "change-email-verification",
    z.object({ name, newEmail: z.email(), url: z.url(), expiresInMinutes: minutes }),
  ),
  queued(
    "change-email-confirmation",
    z.object({
      name,
      newEmail: z.email(),
      url: z.url(),
      expiresInMinutes: minutes,
      securityUrl: z.url(),
    }),
  ),
  queued("password-removed", z.object({ name, securityUrl: z.url() })),
  queued(
    "comp-invitation",
    z.object({
      communityName: name,
      communityBrand,
      email: z.email(),
      url: z.url(),
      expiresAt: z.iso.datetime().nullable(),
      optOutUrl: z.url().optional(),
    }),
  ),
  queued(
    "subscription-moved",
    z.object({ communityName: name, communityBrand, email: z.email(), url: z.url() }),
  ),
  queued(
    "moving-offer",
    z.object({
      communityName: name,
      communityBrand,
      email: z.email(),
      url: z.url(),
      freeUntil: z.iso.datetime().nullable(),
      from: z.string().min(1).max(60).nullable(),
      optOutUrl: z.url().optional(),
    }),
  ),
  queued(
    "data-export-ready",
    z.object({ name, url: z.url(), expiresInDays: z.number().int().positive() }),
  ),
  queued(
    "content-report",
    z.object({
      pageUrl: z.url(),
      reason: z.string().min(1).max(100),
      details: z.string().min(1).max(2000),
      reporterEmail: z.email().nullable(),
      reportedAt: z.iso.datetime(),
    }),
  ),
  queued("content-report-received", z.object({}).strict()),
  queued(
    "contact-message",
    z.object({
      topic: z.string().min(1).max(100),
      name: headerSafeText,
      email: z.email(),
      message: z.string().min(1).max(5000),
      link: z.url().max(2000).nullable(),
      account: z
        .object({
          id: z.string().min(1).max(100),
          name: headerSafeText,
          email: z.email(),
          emailVerified: z.boolean(),
          createdAt: z.iso.datetime(),
          communities: z
            .array(
              z.object({
                name: z.string().min(1).max(200),
                slug: z.string().min(1).max(200),
                role: z.string().min(1).max(40),
              }),
            )
            .max(20),
          moreCommunities: z.number().int().min(0),
        })
        .nullable(),
      edition: z.string().min(1).max(40),
      instanceUrl: z.url(),
      ipHash: z
        .string()
        .regex(/^[0-9a-f]{1,64}$/)
        .nullable(),
      sentAt: z.iso.datetime(),
    }),
  ),
  queued(
    "creator-feedback",
    z.object({
      kind: z.enum(["moment", "exit"]),
      topic: headerSafeText,
      question: z.string().min(1).max(200).nullable(),
      score: z.number().int().min(1).max(5).nullable(),
      reason: headerSafeText.nullable(),
      comment: z.string().min(1).max(1000).nullable(),
      userId: z.uuid(),
      communitySlug: z.string().min(1).max(200).nullable(),
      edition: z.string().min(1).max(40),
      instanceUrl: z.url(),
      sentAt: z.iso.datetime(),
    }),
  ),
  queued(
    "early-access-request",
    z.object({
      email: z.email(),
      platform: headerSafeText.max(40),
      members: headerSafeText.max(40),
      note: z.string().min(1).max(1000).nullable(),
      account: z.object({ id: z.string().min(1).max(100), email: z.email() }).nullable(),
      edition: z.string().min(1).max(40),
      instanceUrl: z.url(),
      ipHash: z
        .string()
        .regex(/^[0-9a-f]{1,64}$/)
        .nullable(),
      sentAt: z.iso.datetime(),
    }),
  ),
]);

export type QueuedEmail = z.infer<typeof queuedEmailSchema>;

function render(email: QueuedEmail): EmailContent {
  switch (email.template) {
    case "email-verification":
      return emailVerificationEmail(email.data);
    case "existing-account-sign-up":
      return existingAccountSignUpEmail(email.data);
    case "password-reset":
      return passwordResetEmail(email.data);
    case "password-changed":
      return passwordChangedEmail({ ...email.data, changedAt: new Date(email.data.changedAt) });
    case "magic-link":
      return magicLinkEmail(email.data);
    case "change-email-verification":
      return changeEmailVerificationEmail(email.data);
    case "change-email-confirmation":
      return changeEmailConfirmationEmail(email.data);
    case "password-removed":
      return passwordRemovedEmail(email.data);
    case "comp-invitation":
      return compInvitationEmail({
        ...email.data,
        expiresAt: email.data.expiresAt ? new Date(email.data.expiresAt) : null,
      });
    case "subscription-moved":
      return subscriptionMovedEmail(email.data);
    case "moving-offer":
      return movingOfferEmail({
        ...email.data,
        freeUntil: email.data.freeUntil ? new Date(email.data.freeUntil) : null,
      });
    case "data-export-ready":
      return dataExportReadyEmail(email.data);
    case "content-report":
      return email.data.reporterEmail
        ? {
            ...contentReportEmail(email.data),
            headers: { "Reply-To": email.data.reporterEmail },
          }
        : contentReportEmail(email.data);
    case "content-report-received":
      return contentReportReceivedEmail();
    case "contact-message":
      return { ...contactMessageEmail(email.data), headers: { "Reply-To": email.data.email } };
    case "creator-feedback":
      return creatorFeedbackEmail(email.data);
    case "early-access-request":
      return { ...earlyAccessRequestEmail(email.data), headers: { "Reply-To": email.data.email } };
  }
}

export function renderQueuedEmail(email: QueuedEmail): EmailMessage {
  return {
    to: email.to,
    ...(email.communityId ? { communityId: email.communityId } : {}),
    ...(email.headers ? { headers: email.headers } : {}),
    ...render(email),
  };
}

export class EmailSendError extends Error {
  constructor(
    readonly template: string,
    readonly code: string,
  ) {
    super(`Could not send the ${template} email (${code})`);
    this.name = "EmailSendError";
  }
}

export async function deliverQueuedEmail(mailer: Mailer, payload: unknown): Promise<void> {
  const email = queuedEmailSchema.parse(payload);
  const message = renderQueuedEmail(email);
  try {
    await mailer.send(message);
  } catch (error) {
    throw new EmailSendError(email.template, emailErrorCode(error));
  }
}

export interface EmailOutbox {
  send(email: QueuedEmail): Promise<void>;
}

export function directEmailOutbox(mailer: Mailer): EmailOutbox {
  return { send: (email) => deliverQueuedEmail(mailer, email) };
}

export interface EmailJobSender {
  getQueue(name: string): Promise<EmailQueueState | null>;
  createQueue(name: string, options: EmailSendQueueOptions): Promise<void>;
  updateQueue(name: string, options: EmailSendQueueOptions): Promise<void>;
  send(name: string, data: object): Promise<string | null>;
}

// createQueue leaves an existing queue as it is, so lifetimes from an earlier release would stay.
export async function ensureEmailSendQueue(jobs: EmailJobSender): Promise<void> {
  const current = await jobs.getQueue(emailSendJob);
  if (!current) {
    await jobs.createQueue(emailSendJob, emailSendQueueOptions);
    return;
  }
  if (queueOptionKeys.some((key) => current[key] !== emailSendQueueOptions[key])) {
    await jobs.updateQueue(emailSendJob, emailSendQueueOptions);
  }
}

export function createEmailOutbox(getSender: () => Promise<EmailJobSender>): EmailOutbox {
  let ready: Promise<EmailJobSender> | undefined;
  function sender(): Promise<EmailJobSender> {
    ready ??= getSender().then(async (jobs) => {
      await ensureEmailSendQueue(jobs);
      return jobs;
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  }
  return {
    async send(email) {
      const payload = queuedEmailSchema.parse(email);
      await (await sender()).send(emailSendJob, payload);
    },
  };
}
