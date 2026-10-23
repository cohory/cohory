import type { SendWelcomeEmail } from "@cohory/notifications";
import type { Job } from "pg-boss";
import { createLogger } from "@cohory/infra/logger";
import { describe, expect, it, vi } from "vitest";

import {
  createNotificationsWelcomeHandler,
  createWelcomeSource,
  NOTIFICATIONS_WELCOME,
  type WelcomeServices,
} from "./jobs/notifications-welcome";

const silentLogger = createLogger({ level: "silent" });
const communityId = "0192f2a4-0000-7000-8000-000000000001";
const userId = "0192f2a4-0000-7000-8000-000000000003";

function job(data: unknown): Job<unknown> {
  return {
    id: "01900000-0000-7000-8000-000000000007",
    name: NOTIFICATIONS_WELCOME,
    data,
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
  } as Job<unknown>;
}

function course(slug: string, status: string, publishedLessonCount: number) {
  return { slug, title: `Course ${slug}`, status, publishedLessonCount };
}

describe("welcome email source", () => {
  it("reads the first published course with lessons and the next event as the member", async () => {
    const listCourses = vi.fn<WelcomeServices["courses"]["listCourses"]>(async () => [
      course("draft", "draft", 3),
      course("empty", "published", 0),
      course("start", "published", 2),
    ]);
    const getNextForViewer = vi.fn<WelcomeServices["calendar"]["getNextForViewer"]>(async () => [
      {
        id: "o1",
        startsAt: new Date("2026-10-23T16:00:00Z"),
        event: { slug: "office-hours", title: "Office hours" },
      },
    ]);
    const source = createWelcomeSource({
      courses: { listCourses },
      calendar: { getNextForViewer },
    });

    const extras = await source({ communityId, userId });

    expect(extras).toEqual({
      firstCourse: { slug: "start", title: "Course start" },
      nextEvent: {
        eventSlug: "office-hours",
        occurrenceId: "o1",
        title: "Office hours",
        startsAt: new Date("2026-10-23T16:00:00Z"),
      },
    });
    expect(listCourses).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      communityId,
    );
  });
});

describe("notifications.welcome job", () => {
  it("sends the welcome for the parsed member and community", async () => {
    const send = vi.fn<SendWelcomeEmail>().mockResolvedValue("sent");

    await createNotificationsWelcomeHandler(silentLogger, send)([job({ communityId, userId })]);

    expect(send).toHaveBeenCalledWith({ communityId, userId });
  });

  it("rejects a malformed payload so pg-boss retries and records it", async () => {
    const send = vi.fn<SendWelcomeEmail>();
    await expect(
      createNotificationsWelcomeHandler(silentLogger, send)([job({ communityId })]),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
