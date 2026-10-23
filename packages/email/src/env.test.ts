import { describe, expect, it } from "vitest";

import { emailConfigProblem, parseEmailEnv } from "./env";

const smtpDefaults = {
  driver: "smtp",
  host: "localhost",
  port: 1025,
  user: undefined,
  password: undefined,
  secure: false,
  requireTls: false,
  fromAddress: "no-reply@localhost",
  replyTo: undefined,
  messageIdHost: "localhost",
  instanceName: "Cohory",
  maxConnections: 3,
  ratePerSecond: 10,
};

describe("parseEmailEnv", () => {
  it("defaults to SMTP on localhost port 1025 so Mailpit works without configuration", () => {
    expect(parseEmailEnv({})).toEqual(smtpDefaults);
  });

  it("treats empty SMTP credentials as no authentication", () => {
    const env = parseEmailEnv({ EMAIL_DRIVER: "smtp", SMTP_USER: "", SMTP_PASSWORD: "" });

    expect(env).toMatchObject({ user: undefined, password: undefined });
  });

  it("reads the SMTP settings and takes only the address from SMTP_FROM", () => {
    const env = parseEmailEnv({
      EMAIL_DRIVER: "smtp",
      SMTP_HOST: "mail.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "hunter2",
      SMTP_FROM: "Club <club@example.test>",
      SMTP_REPLY_TO: "help@example.test",
      SMTP_REQUIRE_TLS: "true",
      APP_URL: "https://example.test",
      INSTANCE_NAME: "Makers Hub",
    });

    expect(env).toEqual({
      ...smtpDefaults,
      host: "mail.example.test",
      port: 587,
      user: "mailer",
      password: "hunter2",
      requireTls: true,
      fromAddress: "club@example.test",
      replyTo: "help@example.test",
      messageIdHost: "example.test",
      instanceName: "Makers Hub",
    });
  });

  it("uses implicit TLS on port 465 unless SMTP_SECURE says otherwise", () => {
    expect(parseEmailEnv({ SMTP_PORT: "465" })).toMatchObject({ secure: true });
    expect(parseEmailEnv({ SMTP_PORT: "465", SMTP_SECURE: "false" })).toMatchObject({
      secure: false,
    });
    expect(parseEmailEnv({ SMTP_PORT: "2465", SMTP_SECURE: "true" })).toMatchObject({
      secure: true,
    });
  });

  it("takes the Message-ID host from BETTER_AUTH_URL when APP_URL is unset", () => {
    expect(parseEmailEnv({ BETTER_AUTH_URL: "https://club.example.test/" })).toMatchObject({
      messageIdHost: "club.example.test",
    });
  });

  it("reads the send rate and the connection pool size", () => {
    expect(
      parseEmailEnv({ EMAIL_RATE_PER_SECOND: "14", EMAIL_MAX_CONNECTIONS: "5" }),
    ).toMatchObject({ ratePerSecond: 14, maxConnections: 5 });
  });

  it("rejects a send rate or pool size below one", () => {
    expect(() => parseEmailEnv({ EMAIL_RATE_PER_SECOND: "0" })).toThrow();
    expect(() => parseEmailEnv({ EMAIL_MAX_CONNECTIONS: "0" })).toThrow();
  });

  it("selects the log driver", () => {
    expect(parseEmailEnv({ EMAIL_DRIVER: "log" })).toEqual({ driver: "log" });
  });

  it("rejects an unknown driver, a non numeric port, and a malformed sender", () => {
    expect(() => parseEmailEnv({ EMAIL_DRIVER: "carrier-pigeon" })).toThrow();
    expect(() => parseEmailEnv({ SMTP_PORT: "abc" })).toThrow();
    expect(() => parseEmailEnv({ SMTP_FROM: "Club <not an address>" })).toThrow();
    expect(() => parseEmailEnv({ SMTP_REQUIRE_TLS: "yes" })).toThrow();
  });
});

describe("parseEmailEnv in production", () => {
  const production = { NODE_ENV: "production", APP_URL: "https://community.example.com" };

  it("refuses a localhost sender", () => {
    expect(() =>
      parseEmailEnv({ ...production, SMTP_FROM: "Cohory <no-reply@localhost>" }),
    ).toThrow(/SMTP_FROM/);
  });

  it("refuses a sender on a domain that does not match APP_URL", () => {
    expect(() => parseEmailEnv({ ...production, SMTP_FROM: "no-reply@gmail.com" })).toThrow(
      /community\.example\.com/,
    );
  });

  it("accepts the APP_URL domain, its parent domain, and its subdomains", () => {
    for (const from of [
      "no-reply@community.example.com",
      "no-reply@example.com",
      "no-reply@mail.community.example.com",
    ]) {
      expect(parseEmailEnv({ ...production, SMTP_FROM: from })).toMatchObject({
        fromAddress: from,
      });
    }
  });

  it("accepts any sender when EMAIL_ALLOW_ANY_FROM is true", () => {
    expect(
      parseEmailEnv({
        ...production,
        SMTP_FROM: "no-reply@other.test",
        EMAIL_ALLOW_ANY_FROM: "true",
      }),
    ).toMatchObject({ fromAddress: "no-reply@other.test" });
  });

  it("accepts localhost when the app itself runs on localhost", () => {
    expect(
      parseEmailEnv({ NODE_ENV: "production", APP_URL: "http://localhost:3000" }),
    ).toMatchObject({ fromAddress: "no-reply@localhost" });
  });

  it("skips the domain check when the app runs on a loopback address", () => {
    for (const appUrl of ["http://localhost:3000", "http://127.0.0.1:3100", "http://[::1]:3000"]) {
      expect(
        parseEmailEnv({
          NODE_ENV: "production",
          APP_URL: appUrl,
          SMTP_HOST: "mailpit",
          SMTP_FROM: "cohory <no-reply@cohory.example>",
        }),
      ).toMatchObject({ fromAddress: "no-reply@cohory.example", host: "mailpit" });
    }
  });

  it("does not check the sender of the log driver", () => {
    expect(parseEmailEnv({ ...production, EMAIL_DRIVER: "log" })).toEqual({ driver: "log" });
  });
});

describe("emailConfigProblem", () => {
  it("returns the reason naming the variable instead of throwing", () => {
    expect(
      emailConfigProblem({
        NODE_ENV: "production",
        APP_URL: "https://community.example.com",
        SMTP_FROM: "no-reply@gmail.com",
      }),
    ).toMatch(/SMTP_FROM uses gmail\.com/);
    expect(emailConfigProblem({ SMTP_PORT: "abc" })).toMatch(/SMTP_PORT/);
  });

  it("returns null for a valid configuration", () => {
    expect(emailConfigProblem({})).toBeNull();
  });
});
