import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createTokensExpiryNoticeHandler,
  TOKENS_EXPIRY_NOTICE,
  type NoticeExpiringTokens,
} from "./jobs/tokens-expiry";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000041",
  name: TOKENS_EXPIRY_NOTICE,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("agents.token_expiry_notice job", () => {
  it("runs once a day with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(TOKENS_EXPIRY_NOTICE, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(TOKENS_EXPIRY_NOTICE, "40 8 * * *");
  });

  it("runs one sweep per job and lets failures reject", async () => {
    const run = vi.fn<NoticeExpiringTokens>().mockResolvedValue({ noticed: 2, failed: 0 });
    await createTokensExpiryNoticeHandler(silentLogger, run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<NoticeExpiringTokens>().mockRejectedValue(new Error("db down"));
    await expect(createTokensExpiryNoticeHandler(silentLogger, failing)([job])).rejects.toThrow(
      "db down",
    );
  });
});
