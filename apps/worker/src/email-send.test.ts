import { EmailSendError, emailSendJob, emailSendQueueOptions } from "@cohory/email";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import { createEmailSendHandler, EMAIL_SEND, type SendQueuedEmail } from "./jobs/email-send";
import { registerJobs, type JobRegistry } from "./worker";

const payload = {
  template: "magic-link",
  to: "ada@example.com",
  data: { url: "https://community.example.com/magic?token=secret-token", expiresInMinutes: 15 },
};

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    name: EMAIL_SEND,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({ level: "info", write: (line: string) => void lines.push(line) });
  return { logger, lines };
}

describe("email.send queue", () => {
  it("is created with retries and backoff and gets a handler", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      createLogger({ level: "silent" }),
    );

    expect(EMAIL_SEND).toBe(emailSendJob);
    expect(createQueue).toHaveBeenCalledWith(EMAIL_SEND, emailSendQueueOptions);
    expect(work).toHaveBeenCalledWith(EMAIL_SEND, expect.any(Function));
  });

  it("hands the payload to the sender and logs the template without the recipient or link", async () => {
    const send = vi.fn<SendQueuedEmail>().mockResolvedValue(undefined);
    const { logger, lines } = capturingLogger();

    await createEmailSendHandler(logger, send)([job(payload)]);

    expect(send).toHaveBeenCalledWith(payload);
    expect(lines.join("")).toContain("magic-link");
    expect(lines.join("")).not.toContain("secret-token");
    expect(lines.join("")).not.toContain("ada@example.com");
  });

  it("fails the job so pg-boss retries it, without the link in the error", async () => {
    const send = vi
      .fn<SendQueuedEmail>()
      .mockRejectedValue(new EmailSendError("magic-link", "ECONNREFUSED"));
    const { logger, lines } = capturingLogger();

    const error: unknown = await createEmailSendHandler(
      logger,
      send,
    )([job(payload)]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailSendError);
    expect(String(error)).not.toContain("secret-token");
    expect(lines.join("")).not.toContain("secret-token");
  });
});
