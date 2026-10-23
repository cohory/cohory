import { describe, expect, it, vi } from "vitest";

import { createLogMailer } from "./drivers/log";
import { emailErrorCode, hashEmailAddress, withEmailLog, type EmailLogEntry } from "./log";

const message = {
  to: "Ada@Example.test",
  subject: "Reset your Cohory password",
  text: "text",
  html: "<p>html</p>",
  template: "password-reset" as const,
};

function recorder() {
  const entries: EmailLogEntry[] = [];
  return { entries, log: { record: async (entry: EmailLogEntry) => void entries.push(entry) } };
}

describe("hashEmailAddress", () => {
  it("hashes the trimmed lower case address as sha256 hex", () => {
    expect(hashEmailAddress(" Ada@Example.test ")).toBe(hashEmailAddress("ada@example.test"));
    expect(hashEmailAddress("ada@example.test")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("emailErrorCode", () => {
  it("prefers the SMTP reply code, then the transport code", () => {
    expect(
      emailErrorCode(Object.assign(new Error("x"), { responseCode: 550, code: "EENVELOPE" })),
    ).toBe("smtp_550");
    expect(emailErrorCode(Object.assign(new Error("x"), { code: "EAUTH" }))).toBe("EAUTH");
    expect(emailErrorCode(new Error("Invalid input"))).toBe("unknown");
    expect(emailErrorCode(Object.assign(new Error("x"), { code: "a b".repeat(40) }))).toBe(
      "unknown",
    );
  });
});

describe("withEmailLog", () => {
  it("records a sent email by template and recipient hash, never the address", async () => {
    const { entries, log } = recorder();
    const mailer = withEmailLog(createLogMailer({ log: () => undefined }), log);

    await mailer.send(message);

    expect(entries).toEqual([
      {
        template: "password-reset",
        recipientHash: hashEmailAddress("ada@example.test"),
        status: "sent",
        errorCode: null,
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("example.test");
  });

  it("records a failed send with its error code and still throws", async () => {
    const { entries, log } = recorder();
    const failing = {
      send: vi.fn(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ESOCKET" });
      }),
    };

    await expect(withEmailLog(failing, log).send(message)).rejects.toThrow("ECONNREFUSED");
    expect(entries).toMatchObject([{ status: "failed", errorCode: "ESOCKET" }]);
  });

  it("labels a message without a template as other", async () => {
    const { entries, log } = recorder();
    await withEmailLog(createLogMailer({ log: () => undefined }), log).send({
      ...message,
      template: undefined,
    });

    expect(entries[0]?.template).toBe("other");
  });

  it("keeps sending when the log cannot be written", async () => {
    const report = vi.fn();
    const inner = createLogMailer({ log: () => undefined });
    const mailer = withEmailLog(
      inner,
      {
        record: async () => {
          throw new Error("database down");
        },
      },
      report,
    );

    await mailer.send(message);

    expect(inner.sent).toHaveLength(1);
    expect(report).toHaveBeenCalledOnce();
  });
});
