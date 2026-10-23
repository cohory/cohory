import { describe, expect, it, vi } from "vitest";

import { createLogMailer } from "./log";

const message = {
  to: "member@example.test",
  subject: "Reset your Cohory password",
  text: "secret link http://localhost/token-value",
  html: "<p>secret link</p>",
};

describe("createLogMailer", () => {
  it("records every sent message in order", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await mailer.send(message);
    await mailer.send({ ...message, to: "second@example.test" });

    expect(mailer.sent.map((sent) => sent.to)).toEqual([
      "member@example.test",
      "second@example.test",
    ]);
    expect(mailer.sent[0]).toEqual(message);
  });

  it("logs the recipient and subject but never the body", async () => {
    const log = vi.fn();
    const mailer = createLogMailer({ log });

    await mailer.send(message);

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("member@example.test");
    expect(line).toContain("Reset your Cohory password");
    expect(line).not.toContain("token-value");
  });

  it("rejects a message without a valid recipient", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await expect(mailer.send({ ...message, to: "not-an-email" })).rejects.toThrow();
    expect(mailer.sent).toHaveLength(0);
  });
});
