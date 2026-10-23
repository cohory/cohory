import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JobDefinition, JobHandler } from "./jobs/definition";
import { createGamificationPointsHandler, GAMIFICATION_POINTS } from "./jobs/gamification-points";
import { createHealthPingHandler, HEALTH_PING } from "./jobs/health-ping";
import {
  createNotificationsFanoutHandler,
  NOTIFICATIONS_FANOUT,
} from "./jobs/notifications-fanout";
import { createPaymentsFeeRemovalHandler, PAYMENTS_FEE_REMOVAL } from "./jobs/payments-fee-removal";
import type { JobDeps } from "./services";
import { jobDefinitions, registerJobs, withPayloadValidation, type JobRegistry } from "./worker";

const silentLogger = createLogger({ level: "silent" });

function fakeJob(data: unknown, name = HEALTH_PING): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000000",
    name,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

describe("jobDefinitions", () => {
  it("names every queue once", () => {
    const names = jobDefinitions.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("creates, works, and schedules every defined queue and logs all of their names", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const schedule = vi.fn<JobRegistry["schedule"]>().mockResolvedValue(undefined);
    const lines: string[] = [];
    const logger = createLogger({ level: "info", write: (line) => lines.push(line) });

    await registerJobs({ createQueue, work, schedule } as JobRegistry, logger);

    const names = jobDefinitions.map((definition) => definition.name);
    expect(createQueue.mock.calls.map(([name]) => name)).toEqual(names);
    expect(work.mock.calls.map(([name]) => name)).toEqual(names);
    expect(schedule.mock.calls.map(([name]) => name)).toEqual(
      jobDefinitions.filter((definition) => definition.cron).map((definition) => definition.name),
    );
    const registered: unknown = JSON.parse(lines.at(-1) ?? "{}");
    expect(registered).toMatchObject({ msg: "job handlers registered", queues: names });
  });
});

describe("registerJobs", () => {
  it("creates the health.ping queue and registers a handler for it", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const registry = {
      createQueue,
      work,
      schedule: vi.fn().mockResolvedValue(undefined),
    } as JobRegistry;

    await registerJobs(registry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(HEALTH_PING);
    expect(work).toHaveBeenCalledWith(HEALTH_PING, expect.any(Function));
  });

  it("creates the notifications.fanout queue with retries and registers a handler for it", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");
    const registry = {
      createQueue,
      work,
      schedule: vi.fn().mockResolvedValue(undefined),
    } as JobRegistry;

    await registerJobs(registry, silentLogger);

    expect(createQueue).toHaveBeenCalledWith(NOTIFICATIONS_FANOUT, {
      retryLimit: 5,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(
      NOTIFICATIONS_FANOUT,
      { pollingIntervalSeconds: 2 },
      expect.any(Function),
    );
  });

  it("polls the notifications.fanout queue at the configured interval", async () => {
    const work = vi.fn().mockResolvedValue("worker-id");
    const registry = {
      createQueue: vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined),
      work,
      schedule: vi.fn().mockResolvedValue(undefined),
    } as JobRegistry;

    await registerJobs(registry, silentLogger, undefined, { fanoutPollSeconds: 0.5 });

    expect(work).toHaveBeenCalledWith(
      NOTIFICATIONS_FANOUT,
      { pollingIntervalSeconds: 0.5 },
      expect.any(Function),
    );
  });
});

describe("gamification.points queue", () => {
  it("is created with retries and gets a handler", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      silentLogger,
    );

    expect(createQueue).toHaveBeenCalledWith(GAMIFICATION_POINTS, {
      retryLimit: 5,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(GAMIFICATION_POINTS, expect.any(Function));
  });

  it("passes parsed like events to the points recorder and rejects malformed ones", async () => {
    const recordPoints = vi.fn<JobDeps["recordPoints"]>().mockResolvedValue({ inserted: 1 });
    const handler = createGamificationPointsHandler(silentLogger, recordPoints);
    const events = [
      {
        type: "like.removed",
        payload: {
          communityId: "0192f0a0-0000-7000-8000-00000000c001",
          reactionId: "0192f0a0-0000-7000-8000-00000000d001",
          subjectType: "comment",
          subjectId: "0192f0a0-0000-7000-8000-00000000b001",
          subjectAuthorId: "0192f0a0-0000-7000-8000-000000000001",
          userId: "0192f0a0-0000-7000-8000-000000000002",
          occurredAt: "2026-10-18T10:00:00.000Z",
        },
      },
    ];

    await handler([fakeJob({ events }, GAMIFICATION_POINTS)]);
    await expect(
      handler([fakeJob({ events: [{ type: "like.removed" }] }, GAMIFICATION_POINTS)]),
    ).rejects.toThrow();

    expect(recordPoints).toHaveBeenCalledTimes(1);
    expect(recordPoints).toHaveBeenCalledWith(events);
  });
});

describe("notifications.fanout handler", () => {
  const events = [
    {
      type: "comment.created",
      payload: {
        communityId: "0192f0a0-0000-7000-8000-00000000c001",
        postId: "0192f0a0-0000-7000-8000-00000000a001",
        commentId: "0192f0a0-0000-7000-8000-00000000b001",
        parentId: null,
        parentAuthorId: null,
        authorId: "0192f0a0-0000-7000-8000-000000000001",
        postAuthorId: "0192f0a0-0000-7000-8000-000000000002",
        mentionedUserIds: [],
      },
    },
  ];

  it("passes the parsed events to the fan-out", async () => {
    const fanOut = vi.fn<JobDeps["fanOutNotifications"]>().mockResolvedValue({ inserted: 1 });
    const handler = createNotificationsFanoutHandler(silentLogger, fanOut);

    await handler([fakeJob({ events }, NOTIFICATIONS_FANOUT)]);

    expect(fanOut).toHaveBeenCalledWith(events);
  });

  it("rejects a malformed payload without touching the database", async () => {
    const fanOut = vi.fn<JobDeps["fanOutNotifications"]>();
    const handler = createNotificationsFanoutHandler(silentLogger, fanOut);

    await expect(
      handler([fakeJob({ events: [{ type: "comment.created" }] }, NOTIFICATIONS_FANOUT)]),
    ).rejects.toThrow();
    expect(fanOut).not.toHaveBeenCalled();
  });
});

describe("health.ping handler", () => {
  it("accepts a payload with an ISO timestamp", async () => {
    const handler = createHealthPingHandler(silentLogger);

    await expect(handler([fakeJob({ sentAt: "2026-10-18T00:00:00Z" })])).resolves.toBeUndefined();
  });

  it("rejects a malformed payload so pg-boss retries or fails the job", async () => {
    const handler = createHealthPingHandler(silentLogger);

    await expect(handler([fakeJob({ sentAt: 42 })])).rejects.toThrow();
  });
});

describe("payments.fee-removal queue", () => {
  it("is created with retries and gets a handler", async () => {
    const createQueue = vi.fn<JobRegistry["createQueue"]>().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue("worker-id");

    await registerJobs(
      { createQueue, work, schedule: vi.fn().mockResolvedValue(undefined) } as JobRegistry,
      silentLogger,
    );

    expect(createQueue).toHaveBeenCalledWith(PAYMENTS_FEE_REMOVAL, {
      retryLimit: 8,
      retryBackoff: true,
    });
    expect(work).toHaveBeenCalledWith(PAYMENTS_FEE_REMOVAL, expect.any(Function));
  });

  it("removes the fee for the connection in the payload and rejects malformed payloads", async () => {
    const remove = vi
      .fn<JobDeps["removeApplicationFees"]>()
      .mockResolvedValue({ cleared: 2, remaining: 0 });
    const handler = createPaymentsFeeRemovalHandler(silentLogger, remove);
    const connectionId = "01900000-0000-7000-8000-000000000001";

    await handler([fakeJob({ connectionId }, PAYMENTS_FEE_REMOVAL)]);
    expect(remove).toHaveBeenCalledWith(connectionId);

    await expect(
      handler([fakeJob({ connectionId: "nope" }, PAYMENTS_FEE_REMOVAL)]),
    ).rejects.toThrow();
  });

  it("fails the job when subscriptions still carry the fee so pg-boss retries", async () => {
    const remove = vi
      .fn<JobDeps["removeApplicationFees"]>()
      .mockRejectedValue(new Error("fee_removal_incomplete"));
    const handler = createPaymentsFeeRemovalHandler(silentLogger, remove);

    await expect(
      handler([
        fakeJob({ connectionId: "01900000-0000-7000-8000-000000000001" }, PAYMENTS_FEE_REMOVAL),
      ]),
    ).rejects.toThrow("fee_removal_incomplete");
  });
});

describe("payload validation", () => {
  const definition: JobDefinition = {
    name: "test.payload",
    payloadSchema: z.object({ communityId: z.uuid() }),
    handler: () => async () => undefined,
  };

  it("rejects a job whose payload fails the queue schema before the handler runs", async () => {
    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
    const guarded = withPayloadValidation(definition, handler);

    await expect(guarded([fakeJob({ communityId: "nope" }, "test.payload")])).rejects.toThrow(
      'Job payload for queue "test.payload" is invalid',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("hands valid jobs to the handler with their data untouched", async () => {
    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
    const job = fakeJob({ communityId: "01900000-0000-7000-8000-000000000001" }, "test.payload");

    await withPayloadValidation(definition, handler)([job]);

    expect(handler).toHaveBeenCalledWith([job]);
  });

  it("leaves cron only queues without a schema unwrapped", () => {
    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
    const cron: JobDefinition = { name: "test.cron", cron: "* * * * *", handler: () => handler };

    expect(withPayloadValidation(cron, handler)).toBe(handler);
  });

  it("validates every registered queue that declares a payload schema", async () => {
    const work = vi.fn().mockResolvedValue("worker-id");
    const registry = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work,
      schedule: vi.fn().mockResolvedValue(undefined),
    } as JobRegistry;

    await registerJobs(registry, silentLogger);

    for (const queue of jobDefinitions.filter((item) => item.payloadSchema)) {
      const registered: unknown = work.mock.calls.find(([name]) => name === queue.name)?.at(-1);
      if (typeof registered !== "function") {
        throw new Error(`no handler for ${queue.name}`);
      }
      await expect(registered([fakeJob("malformed", queue.name)])).rejects.toThrow(
        `Job payload for queue "${queue.name}" is invalid`,
      );
    }
  });
});
