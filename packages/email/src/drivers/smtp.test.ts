import { describe, expect, it } from "vitest";

import type { SmtpEnv } from "../env";
import { smtpMailOptions, smtpTransportOptions } from "./smtp";

const env: SmtpEnv = {
  driver: "smtp",
  host: "smtp.example.com",
  port: 587,
  user: "mailer",
  password: "secret",
  secure: false,
  requireTls: true,
  fromAddress: "notifications@example.com",
  replyTo: "help@example.com",
  messageIdHost: "community.example.com",
  instanceName: "Makers Hub",
  maxConnections: 3,
  ratePerSecond: 8,
};

const message = {
  to: "ada@example.test",
  subject: "[Design Club] Ada mentioned you",
  text: "text",
  html: "<p>html</p>",
};

describe("smtpTransportOptions", () => {
  it("passes implicit TLS, required STARTTLS, and credentials to the transport", () => {
    expect(smtpTransportOptions(env)).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "mailer", pass: "secret" },
    });
  });

  it("reuses a small pool of connections and caps messages per second", () => {
    expect(smtpTransportOptions(env)).toMatchObject({
      pool: true,
      maxConnections: 3,
      rateDelta: 1000,
      rateLimit: 8,
    });
  });

  it("sends no credentials when there is no user", () => {
    expect(smtpTransportOptions({ ...env, user: undefined }).auth).toBeUndefined();
  });
});

describe("smtpMailOptions", () => {
  it("sends as the community through the one configured address", () => {
    const options = smtpMailOptions(env, { ...message, fromName: "Design Club via Makers Hub" });

    expect(options.from).toEqual({
      name: "Design Club via Makers Hub",
      address: "notifications@example.com",
    });
    expect(options.replyTo).toBe("help@example.com");
  });

  it("falls back to the instance name as the sender name", () => {
    expect(smtpMailOptions(env, message).from).toEqual({
      name: "Makers Hub",
      address: "notifications@example.com",
    });
  });

  it("sets a unique Message-ID on the APP_URL host", () => {
    const first = smtpMailOptions(env, message).messageId;
    const second = smtpMailOptions(env, message).messageId;

    expect(first).toMatch(/^<[0-9a-f-]{36}@community\.example\.com>$/);
    expect(second).not.toBe(first);
  });

  it("marks every email as automatic so vacation replies stay away", () => {
    expect(smtpMailOptions(env, message).headers).toEqual({
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
    });
  });

  it("keeps the headers a sender passes next to the automatic ones", () => {
    const options = smtpMailOptions(env, {
      ...message,
      headers: { "List-Id": "<design.example.com>" },
    });

    expect(options.headers).toMatchObject({
      "List-Id": "<design.example.com>",
      "Auto-Submitted": "auto-generated",
    });
  });

  it("does not pass the community id on as a field of the message", () => {
    const options = smtpMailOptions(env, {
      ...message,
      communityId: "0192a1b2-0000-7000-8000-000000000001",
    });

    expect(options).not.toHaveProperty("communityId");
  });

  it("does not pass the template name or sender name on as fields of the message", () => {
    const options = smtpMailOptions(env, { ...message, template: "notification", fromName: "X" });

    expect(options).not.toHaveProperty("template");
    expect(options).not.toHaveProperty("fromName");
    expect(options).toMatchObject({ to: message.to, subject: message.subject });
  });

  it("attaches a calendar invite as the iCalendar part calendars add on their own", () => {
    const content = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n";
    const options = smtpMailOptions(env, {
      ...message,
      calendarInvite: { method: "REQUEST", content },
    });

    expect(options.icalEvent).toEqual({ method: "REQUEST", content });
    expect(options).not.toHaveProperty("calendarInvite");
    expect(smtpMailOptions(env, message)).not.toHaveProperty("icalEvent");
  });
});
