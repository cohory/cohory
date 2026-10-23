import { describe, expect, it, vi } from "vitest";

import { createLogMailer } from "./drivers/log";
import type { Mailer } from "./message";
import {
  createEmailOutbox,
  deliverQueuedEmail,
  directEmailOutbox,
  emailSendJob,
  emailSendQueueOptions,
  type EmailJobSender,
  type QueuedEmail,
} from "./queue";

vi.stubEnv("APP_URL", "https://community.example.com");

const tokenUrl = "https://community.example.com/api/auth/verify-email?token=secret-token-123";

const verification: QueuedEmail = {
  template: "email-verification",
  to: "ada@example.com",
  data: { name: "Ada", url: tokenUrl, expiresInMinutes: 60 },
};

function sender(existing: Awaited<ReturnType<EmailJobSender["getQueue"]>> = null) {
  const getQueue = vi.fn<EmailJobSender["getQueue"]>().mockResolvedValue(existing);
  const createQueue = vi.fn<EmailJobSender["createQueue"]>().mockResolvedValue(undefined);
  const updateQueue = vi.fn<EmailJobSender["updateQueue"]>().mockResolvedValue(undefined);
  const send = vi.fn<EmailJobSender["send"]>().mockResolvedValue("job-1");
  return { getQueue, createQueue, updateQueue, send };
}

describe("createEmailOutbox", () => {
  it("queues the email as an email.send job with retries and backoff", async () => {
    const jobs = sender();
    const outbox = createEmailOutbox(() => Promise.resolve(jobs));

    await outbox.send(verification);

    expect(jobs.createQueue).toHaveBeenCalledWith(emailSendJob, emailSendQueueOptions);
    expect(jobs.send).toHaveBeenCalledWith(emailSendJob, verification);
    expect(emailSendQueueOptions).toMatchObject({ retryBackoff: true });
  });

  it("drops queued and finished jobs before the shortest link in them expires", () => {
    const shortestLinkSeconds = 15 * 60;
    const { retryLimit, retryDelay, retryDelayMax } = emailSendQueueOptions;
    const worstRetryWait = Array.from({ length: retryLimit }, (_, attempt) =>
      Math.min(retryDelay * 2 ** attempt, retryDelayMax),
    ).reduce((total, wait) => total + wait, 0);

    expect(emailSendQueueOptions.retentionSeconds).toBeLessThanOrEqual(shortestLinkSeconds);
    expect(emailSendQueueOptions.deleteAfterSeconds).toBeLessThanOrEqual(shortestLinkSeconds);
    expect(worstRetryWait).toBeLessThan(emailSendQueueOptions.retentionSeconds);
  });

  it("updates a queue created earlier with other lifetimes", async () => {
    const jobs = sender({ ...emailSendQueueOptions, deleteAfterSeconds: 3600 });
    const outbox = createEmailOutbox(() => Promise.resolve(jobs));

    await outbox.send(verification);

    expect(jobs.createQueue).not.toHaveBeenCalled();
    expect(jobs.updateQueue).toHaveBeenCalledWith(emailSendJob, emailSendQueueOptions);
  });

  it("leaves a queue alone when its options already match", async () => {
    const jobs = sender({ ...emailSendQueueOptions });
    const outbox = createEmailOutbox(() => Promise.resolve(jobs));

    await outbox.send(verification);

    expect(jobs.createQueue).not.toHaveBeenCalled();
    expect(jobs.updateQueue).not.toHaveBeenCalled();
  });

  it("creates the queue once for many emails", async () => {
    const jobs = sender();
    const outbox = createEmailOutbox(() => Promise.resolve(jobs));

    await outbox.send(verification);
    await outbox.send(verification);

    expect(jobs.createQueue).toHaveBeenCalledOnce();
    expect(jobs.send).toHaveBeenCalledTimes(2);
  });

  it("refuses an email that does not match its template before queueing it", async () => {
    const jobs = sender();
    const outbox = createEmailOutbox(() => Promise.resolve(jobs));
    const broken = { ...verification, to: "not an address" };

    await expect(outbox.send(broken)).rejects.toThrow();
    expect(jobs.send).not.toHaveBeenCalled();
  });
});

describe("deliverQueuedEmail", () => {
  it("renders the template and sends it to the recipient", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await deliverQueuedEmail(mailer, verification);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: "ada@example.com",
      subject: "Confirm your email address",
      template: "email-verification",
    });
    expect(mailer.sent[0]?.text).toContain(tokenUrl);
  });

  it("renders a community invitation with its end date", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await deliverQueuedEmail(mailer, {
      template: "comp-invitation",
      to: "ada@example.com",
      data: {
        communityName: "Design Club",
        communityBrand: { logoUrl: null, accent: "#7C3AED" },
        email: "ada@example.com",
        url: "https://community.example.com/sign-in",
        expiresAt: "2026-12-31T23:59:59.999Z",
      },
    });

    expect(mailer.sent[0]?.subject).toContain("[Design Club]");
    expect(mailer.sent[0]?.text).toContain("December 31, 2026");
  });

  it("fails with only an error code so the link never reaches the job record", async () => {
    const failing: Mailer = {
      send: () =>
        Promise.reject(
          Object.assign(new Error(`could not send ${tokenUrl}`), { code: "ECONNREFUSED" }),
        ),
    };

    const error: unknown = await deliverQueuedEmail(failing, verification).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("ECONNREFUSED");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("secret-token");
  });

  it("rejects a payload for an unknown template", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await expect(
      deliverQueuedEmail(mailer, { template: "nope", to: "ada@example.com", data: {} }),
    ).rejects.toThrow();
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("directEmailOutbox", () => {
  it("renders and sends at once", async () => {
    const mailer = createLogMailer({ log: () => undefined });

    await directEmailOutbox(mailer).send(verification);

    expect(mailer.sent[0]?.to).toBe("ada@example.com");
  });
});
