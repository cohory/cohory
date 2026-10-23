import { MemberEmailInterruptedError, type SendMemberEmail } from "@cohory/posts/member-email-job";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import { createPostsMemberEmailHandler, POSTS_MEMBER_EMAIL } from "./jobs/posts-member-email";

const silentLogger = createLogger({ level: "silent" });
const emailed = {
  communityId: "0192f2a4-0000-7000-8000-000000000001",
  postId: "0192f2a4-0000-7000-8000-000000000002",
  sentBy: "0192f2a4-0000-7000-8000-000000000003",
  occurredAt: "2026-10-22T09:00:00.000Z",
};

function job(data: unknown, signal = new AbortController().signal): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000007",
    name: POSTS_MEMBER_EMAIL,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
    signal,
  };
}

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "info",
    write: (line: string) => lines.push(JSON.parse(line)),
  });
  return { logger, lines };
}

const events = { events: [{ type: "post.emailed", payload: emailed }] };

describe("posts member email handler", () => {
  it("sends the emailed post to members once per event, with the job's abort signal", async () => {
    const send = vi
      .fn<SendMemberEmail>()
      .mockResolvedValue({ sent: 3, failed: 0, skipped: false, stopped: false });
    const signal = new AbortController().signal;

    await createPostsMemberEmailHandler(silentLogger, send)([job(events, signal)]);

    expect(send).toHaveBeenCalledExactlyOnceWith(emailed, { signal });
  });

  it("logs how many emails went out when the job stopped early", async () => {
    const { logger, lines } = capturingLogger();
    const send = vi
      .fn<SendMemberEmail>()
      .mockResolvedValue({ sent: 1, failed: 0, skipped: false, stopped: true });

    await createPostsMemberEmailHandler(logger, send)([job(events)]);

    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", postId: emailed.postId, sent: 1, stopped: true }),
    );
  });

  it("logs the partial send and fails the job when the run breaks off", async () => {
    const { logger, lines } = capturingLogger();
    const send = vi
      .fn<SendMemberEmail>()
      .mockRejectedValue(new MemberEmailInterruptedError(2, 1, new Error("db down")));

    await expect(createPostsMemberEmailHandler(logger, send)([job(events)])).rejects.toThrow(
      MemberEmailInterruptedError,
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", postId: emailed.postId, sent: 2, failed: 1 }),
    );
  });

  it("refuses a malformed payload", async () => {
    const send = vi.fn<SendMemberEmail>();

    await expect(
      createPostsMemberEmailHandler(
        silentLogger,
        send,
      )([job({ events: [{ type: "post.emailed", payload: { postId: "nope" } }] })]),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
