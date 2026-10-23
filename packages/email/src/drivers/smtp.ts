import { randomUUID } from "node:crypto";

import nodemailer from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";

import type { SmtpEnv } from "../env";
import { emailMessageSchema, type EmailMessage, type Mailer } from "../message";

export function smtpTransportOptions(env: SmtpEnv): SMTPPool.Options {
  return {
    host: env.host,
    port: env.port,
    secure: env.secure,
    requireTLS: env.requireTls,
    auth: env.user === undefined ? undefined : { user: env.user, pass: env.password ?? "" },
    pool: true,
    maxConnections: env.maxConnections,
    rateDelta: 1000,
    rateLimit: env.ratePerSecond,
  };
}

const automaticHeaders = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "OOF, AutoReply",
};

export function smtpMailOptions(env: SmtpEnv, message: EmailMessage): SMTPPool.MailOptions {
  const { to, subject, text, html, headers, fromName, calendarInvite } = message;
  return {
    ...(calendarInvite ? { icalEvent: calendarInvite } : {}),
    to,
    subject,
    text,
    html,
    headers: { ...automaticHeaders, ...headers },
    from: { name: fromName ?? env.instanceName, address: env.fromAddress },
    replyTo: env.replyTo,
    messageId: `<${randomUUID()}@${env.messageIdHost}>`,
  };
}

export function createSmtpMailer(env: SmtpEnv): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(env));

  return {
    async send(message) {
      await transport.sendMail(smtpMailOptions(env, emailMessageSchema.parse(message)));
    },
  };
}
