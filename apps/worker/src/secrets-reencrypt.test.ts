import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createSecretsReencryptHandler,
  SECRETS_REENCRYPT,
  type ReencryptSecrets,
} from "./jobs/secrets-reencrypt";
import { registerJobs, type JobRegistry } from "./worker";

const job = {
  id: "01900000-0000-7000-8000-000000000031",
  name: SECRETS_REENCRYPT,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("secrets.reencrypt job", () => {
  it("runs every hour with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs(
      { createQueue, work: vi.fn().mockResolvedValue("id"), schedule } as JobRegistry,
      createLogger({ level: "silent" }),
    );

    expect(createQueue).toHaveBeenCalledWith(SECRETS_REENCRYPT, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(SECRETS_REENCRYPT, "41 * * * *");
  });

  it("logs the ids it could not decrypt, never the secrets", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", write: (line: string) => lines.push(line) });
    const run = vi.fn<ReencryptSecrets>().mockResolvedValue({
      payments: { scanned: 3, reencrypted: 2, unreadable: ["conn-1"] },
      webhooks: { scanned: 1, reencrypted: 1, unreadable: [] },
    });

    await createSecretsReencryptHandler(logger, run)([job]);

    expect(run).toHaveBeenCalledOnce();
    const warning = lines.find((line) => line.includes("could not be decrypted"));
    expect(warning).toContain("conn-1");
  });

  it("lets a failure reject so pg-boss records it", async () => {
    const run = vi.fn<ReencryptSecrets>().mockRejectedValue(new Error("db down"));
    await expect(
      createSecretsReencryptHandler(createLogger({ level: "silent" }), run)([job]),
    ).rejects.toThrow("db down");
  });
});
