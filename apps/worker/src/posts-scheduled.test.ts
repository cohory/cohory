import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createPublishScheduledHandler,
  POSTS_PUBLISH_SCHEDULED,
  type PublishScheduledDeps,
} from "./jobs/posts-scheduled";
import { registerJobs, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

const job = {
  id: "01900000-0000-7000-8000-000000000031",
  name: POSTS_PUBLISH_SCHEDULED,
  data: null,
  expireInSeconds: 60,
  heartbeatSeconds: null,
  retryCount: 0,
} as Job<unknown>;

const outboxId = "01900000-0000-7000-8000-0000000000e1";

describe("posts.publish-scheduled job", () => {
  it("runs every minute with one active run at a time", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);

    await registerJobs({ createQueue, work, schedule } as JobRegistry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(POSTS_PUBLISH_SCHEDULED, { policy: "stately" });
    expect(work).toHaveBeenCalledWith(POSTS_PUBLISH_SCHEDULED, expect.any(Function));
    expect(schedule).toHaveBeenCalledWith(POSTS_PUBLISH_SCHEDULED, "* * * * *");
  });

  it("relays the outbox rows of the posts it published", async () => {
    const deps = {
      publishDue: vi.fn<PublishScheduledDeps["publishDue"]>().mockResolvedValue({
        published: [{ postId: "p", outboxId, events: [] }],
        discarded: 1,
        errors: [],
      }),
      relay: vi
        .fn<PublishScheduledDeps["relay"]>()
        .mockResolvedValue({ published: 1, failed: 0, errors: [] }),
    };
    await createPublishScheduledHandler(silentLogger, deps)([job]);
    expect(deps.relay).toHaveBeenCalledWith([outboxId]);
  });

  it("does not relay when nothing was published", async () => {
    const deps = {
      publishDue: vi
        .fn<PublishScheduledDeps["publishDue"]>()
        .mockResolvedValue({ published: [], discarded: 0, errors: [] }),
      relay: vi.fn<PublishScheduledDeps["relay"]>(),
    };
    await createPublishScheduledHandler(silentLogger, deps)([job]);
    expect(deps.relay).not.toHaveBeenCalled();
  });

  it("leaves events for the outbox sweep when the relay fails", async () => {
    const deps = {
      publishDue: vi.fn<PublishScheduledDeps["publishDue"]>().mockResolvedValue({
        published: [{ postId: "p", outboxId, events: [] }],
        discarded: 0,
        errors: [],
      }),
      relay: vi.fn<PublishScheduledDeps["relay"]>().mockRejectedValue(new Error("queue down")),
    };
    await expect(createPublishScheduledHandler(silentLogger, deps)([job])).resolves.toBeUndefined();
  });

  it("lets a failing publish pass reject so the job is retried", async () => {
    const deps = {
      publishDue: vi
        .fn<PublishScheduledDeps["publishDue"]>()
        .mockRejectedValue(new Error("db down")),
      relay: vi.fn<PublishScheduledDeps["relay"]>(),
    };
    await expect(createPublishScheduledHandler(silentLogger, deps)([job])).rejects.toThrow(
      "db down",
    );
  });
});
