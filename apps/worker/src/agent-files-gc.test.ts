import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_FILES_GC,
  createAgentFilesGcHandler,
  type CollectAgentFileGarbage,
} from "./jobs/agent-files-gc";
import { registerJobs, type JobRegistry } from "./worker";

const job = {
  id: "01900000-0000-7000-8000-000000000041",
  name: AGENT_FILES_GC,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

describe("courses.agent-files-gc job", () => {
  it("runs once a day with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs(
      { createQueue, work: vi.fn().mockResolvedValue("id"), schedule } as JobRegistry,
      createLogger({ level: "silent" }),
    );

    expect(createQueue).toHaveBeenCalledWith(AGENT_FILES_GC, { policy: "stately" });
    expect(schedule).toHaveBeenCalledWith(AGENT_FILES_GC, "50 4 * * *");
  });

  it("runs one collection per job and lets failures reject", async () => {
    const run = vi
      .fn<CollectAgentFileGarbage>()
      .mockResolvedValue({ courses: 2, deleted: 1, bytes: 10 });
    await createAgentFilesGcHandler(createLogger({ level: "silent" }), run)([job]);
    expect(run).toHaveBeenCalledOnce();

    const failing = vi.fn<CollectAgentFileGarbage>().mockRejectedValue(new Error("storage down"));
    await expect(
      createAgentFilesGcHandler(createLogger({ level: "silent" }), failing)([job]),
    ).rejects.toThrow("storage down");
  });
});
