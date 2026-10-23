import { describe, expect, it } from "vitest";

import { createLogMailer } from "./drivers/log";
import { hashEmailAddress, type EmailLog, type EmailLogEntry } from "./log";
import type { EmailMessage, Mailer } from "./message";
import {
  createMemorySuppressionList,
  isPermanentRecipientFailure,
  isSecurityEmail,
  securityEmailTemplates,
  withSuppression,
} from "./suppression";
import { compInvitationEmail } from "./templates/comp-invitation";
import { emailVerificationEmail } from "./templates/email-verification";
import { eventReminderEmail } from "./templates/event-reminder";
import { existingAccountSignUpEmail } from "./templates/existing-account-sign-up";
import { memberInvitedEmail } from "./templates/migration";
import { notificationEmail } from "./templates/notification";
import { passwordResetEmail } from "./templates/password-reset";
import { deliverQueuedEmail, queuedEmailSchema, renderQueuedEmail } from "./queue";

const address = "bounced@example.com";
const communityId = "0192a1b2-0000-7000-8000-000000000001";
const otherCommunityId = "0192a1b2-0000-7000-8000-000000000002";

function memoryLog(): EmailLog & { entries: EmailLogEntry[] } {
  const entries: EmailLogEntry[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
    },
  };
}

function setup() {
  const list = createMemorySuppressionList();
  const log = memoryLog();
  const driver = createLogMailer({ log: () => undefined });
  const mailer = withSuppression(driver, { list, log });
  return { list, log, driver, mailer };
}

const notification = notificationEmail({
  name: "Ada",
  subject: "Grace replied to your comment",
  items: [{ sentence: "Grace replied to your comment in Design Club." }],
  cta: { label: "Open the comment", url: "https://cohory.example.com/c/design/posts/1" },
  communityName: "Design Club",
  reason: "replies to your comments",
  unsubscribeUrl: "https://cohory.example.com/unsubscribe?token=t",
  preferencesUrl: "https://cohory.example.com/account/notifications",
});

const nonSecurity: Array<[string, Omit<EmailMessage, "to">]> = [
  ["a notification", { ...notification, communityId }],
  [
    "an invitation",
    {
      ...memberInvitedEmail({
        name: "Ada",
        communityName: "Design Club",
        url: "https://cohory.example.com/join/t",
      }),
      communityId,
    },
  ],
  [
    "a free access offer",
    {
      ...compInvitationEmail({
        communityName: "Design Club",
        email: address,
        url: "https://cohory.example.com/c/design/membership",
        expiresAt: null,
      }),
      communityId,
    },
  ],
  [
    "an event reminder",
    {
      ...eventReminderEmail({
        name: "Ada",
        title: "Office hours",
        when: "Tuesday 3 PM",
        eventWhen: null,
        location: null,
        eventUrl: "https://cohory.example.com/c/design/calendar/office-hours/o1",
        footer: null,
        communityName: "Design Club",
      }),
      communityId,
    },
  ],
];

const security: Array<[string, Omit<EmailMessage, "to">]> = [
  [
    "a password reset",
    passwordResetEmail({ name: "Ada", url: "https://cohory.example.com/r", expiresInMinutes: 60 }),
  ],
  [
    "an email verification",
    emailVerificationEmail({ name: "Ada", url: "https://cohory.example.com/v" }),
  ],
  [
    "a sign up attempt on an existing account",
    existingAccountSignUpEmail({
      name: "Ada",
      signInUrl: "https://cohory.example.com/sign-in",
      resetUrl: "https://cohory.example.com/forgot-password",
    }),
  ],
];

describe("withSuppression", () => {
  it.each(nonSecurity)("skips %s to an address that hard bounced", async (_label, content) => {
    const { list, log, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId: null,
      reason: "hard_bounce",
      source: "smtp",
    });

    await mailer.send({ to: address, ...content });

    expect(driver.sent).toEqual([]);
    expect(log.entries).toEqual([
      {
        template: content.template,
        recipientHash: hashEmailAddress(address),
        status: "suppressed",
        errorCode: "hard_bounce",
      },
    ]);
  });

  it.each(security)("still sends %s to a suppressed address", async (_label, content) => {
    const { list, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId: null,
      reason: "complaint",
      source: "webhook",
    });

    await mailer.send({ to: address, ...content });

    expect(driver.sent).toHaveLength(1);
  });

  it("matches the address without regard to case or surrounding spaces", async () => {
    const { list, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId: null,
      reason: "manual",
      source: "operator",
    });

    await mailer.send({ to: "Bounced@Example.com", ...notification });

    expect(driver.sent).toEqual([]);
  });

  it("skips email about the community the person opted out of, and only that one", async () => {
    const { list, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId,
      reason: "opt_out",
      source: "member",
    });

    await mailer.send({ to: address, ...notification, communityId });
    await mailer.send({ to: address, ...notification, communityId: otherCommunityId });
    await mailer.send({ to: address, ...notification });

    expect(driver.sent.map((sent) => sent.communityId)).toEqual([otherCommunityId, undefined]);
  });

  it("sends to an address that is not on the list", async () => {
    const { driver, mailer } = setup();

    await mailer.send({ to: "fine@example.com", ...notification });

    expect(driver.sent).toHaveLength(1);
  });

  it("adds a hard bounce when the server rejects the recipient permanently, and does not throw", async () => {
    const list = createMemorySuppressionList();
    const rejecting: Mailer = {
      async send() {
        throw Object.assign(new Error("550 5.1.1 User unknown"), {
          responseCode: 550,
          command: "RCPT TO",
          response: "550 5.1.1 User unknown",
        });
      },
    };
    const mailer = withSuppression(rejecting, { list, log: memoryLog() });

    await expect(mailer.send({ to: address, ...notification })).resolves.toBeUndefined();

    expect(await list.isSuppressed({ addressHash: hashEmailAddress(address) })).toBe(true);
  });

  it("rethrows and suppresses nothing when the failure is not about the recipient", async () => {
    const list = createMemorySuppressionList();
    const failing: Mailer = {
      async send() {
        throw Object.assign(new Error("535 Authentication failed"), {
          responseCode: 535,
          command: "AUTH PLAIN",
        });
      },
    };
    const mailer = withSuppression(failing, { list, log: memoryLog() });

    await expect(mailer.send({ to: address, ...notification })).rejects.toThrow(
      "Authentication failed",
    );
    expect(await list.isSuppressed({ addressHash: hashEmailAddress(address) })).toBe(false);
  });
});

describe("isPermanentRecipientFailure", () => {
  const rcpt = (responseCode: number, response?: string) => ({
    responseCode,
    command: "RCPT TO",
    ...(response ? { response } : {}),
  });

  it.each([
    ["550 5.1.1 user unknown", rcpt(550, "550 5.1.1 <x@example.com>: user unknown")],
    ["552 5.2.1 mailbox disabled", rcpt(552, "552 5.2.1 Mailbox disabled")],
    [
      "5.1.1 reported after DATA",
      { responseCode: 550, command: "DATA", response: "550 5.1.1 no such user" },
    ],
    ["bare 550 without an enhanced code", rcpt(550)],
    ["bare 551 without an enhanced code", rcpt(551, "551 User not local")],
    ["bare 553 without an enhanced code", rcpt(553)],
  ])("suppresses %s", (_label, error) => {
    expect(isPermanentRecipientFailure(error)).toBe(true);
  });

  it.each([
    ["550 5.7.1 relay access denied", rcpt(550, "550 5.7.1 Relay access denied")],
    ["554 5.7.1 policy rejection", rcpt(554, "554 5.7.1 Service unavailable; client host blocked")],
    ["550 5.7.606 IP blocklisted", rcpt(550, "550 5.7.606 Access denied, banned sending IP")],
    ["550 5.4.1 recipient domain refused", rcpt(550, "550 5.4.1 Recipient address rejected")],
    [
      "554 5.7.1 spam after DATA",
      { responseCode: 554, command: "DATA", response: "554 5.7.1 spam" },
    ],
    ["bare 554 without an enhanced code", rcpt(554)],
    ["a temporary 450", rcpt(450)],
    ["an authentication failure", { responseCode: 535, command: "AUTH PLAIN" }],
    ["a connection error", { code: "ECONNECTION" }],
    ["a string", "550"],
  ])("does not suppress %s", (_label, error) => {
    expect(isPermanentRecipientFailure(error)).toBe(false);
  });
});

describe("isSecurityEmail", () => {
  it("treats the account emails a person asks for as security email", () => {
    expect([...securityEmailTemplates].sort()).toEqual([
      "change-email-confirmation",
      "change-email-verification",
      "email-verification",
      "existing-account-sign-up",
      "magic-link",
      "password-changed",
      "password-removed",
      "password-reset",
    ]);
  });

  it.each(security)("knows %s is security email", (_label, content) => {
    expect(isSecurityEmail(content)).toBe(true);
  });

  it("does not treat a message without a template as security email", () => {
    expect(isSecurityEmail({})).toBe(false);
  });
});

describe("the email.send job path", () => {
  it("skips a community email to a suppressed address and still sends the magic link", async () => {
    const { list, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId: null,
      reason: "complaint",
      source: "webhook",
    });

    await deliverQueuedEmail(mailer, {
      template: "comp-invitation",
      to: address,
      communityId,
      data: {
        communityName: "Design Club",
        email: address,
        url: "https://cohory.example.com/c/design/membership",
        expiresAt: null,
      },
    });
    await deliverQueuedEmail(mailer, {
      template: "magic-link",
      to: address,
      data: { url: "https://cohory.example.com/api/auth/magic-link?token=t", expiresInMinutes: 15 },
    });

    expect(driver.sent.map((sent) => sent.template)).toEqual(["magic-link"]);
  });

  it("applies a community opt out to a queued email that names the community", async () => {
    const { list, driver, mailer } = setup();
    await list.suppress({
      addressHash: hashEmailAddress(address),
      communityId,
      reason: "opt_out",
      source: "member",
    });

    await deliverQueuedEmail(mailer, {
      template: "comp-invitation",
      to: address,
      communityId,
      data: {
        communityName: "Design Club",
        email: address,
        url: "https://cohory.example.com/c/design/membership",
        expiresAt: null,
      },
    });

    expect(driver.sent).toEqual([]);
  });

  it("carries the opt out link and headers through the queue", () => {
    const headers = {
      "List-Unsubscribe": "<https://cohory.example.com/api/email-opt-out?token=t>",
    };
    const message = renderQueuedEmail(
      queuedEmailSchema.parse({
        template: "comp-invitation",
        to: address,
        communityId,
        headers,
        data: {
          communityName: "Design Club",
          email: address,
          url: "https://cohory.example.com/c/design/membership",
          expiresAt: null,
          optOutUrl: "https://cohory.example.com/email-opt-out?token=t",
        },
      }),
    );

    expect(message).toMatchObject({ communityId, headers });
    expect(message.text).toContain("Don't email me about Design Club");
  });
});
