import { UnauthenticatedError, type Actor } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import {
  NotificationValidationError,
  type ListNotificationsInput,
  type MarkReadInput,
  type NotificationPage,
  type NotificationsService,
} from "@cohory/notifications";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDeps } from "../services";

import { createApi, createOpenApiDocument } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const userId = "0192f0a0-0000-7000-8000-00000000000a";
const notificationId = "0192f0a0-0000-7000-8000-000000000001";

const samplePage: NotificationPage = {
  data: [
    {
      id: notificationId,
      type: "comment_on_post",
      community: { id: "0192f0a0-0000-7000-8000-0000000000c1", slug: "makers", name: "Makers" },
      actor: { id: "0192f0a0-0000-7000-8000-0000000000b0", name: "Bob", image: null },
      subjectType: "comment",
      subjectId: "0192f0a0-0000-7000-8000-0000000000d1",
      postId: "0192f0a0-0000-7000-8000-0000000000e1",
      href: "/c/makers/posts/0192f0a0-0000-7000-8000-0000000000e1",
      text: "Bob commented on your post",
      preview: "Love the glaze",
      readAt: null,
      createdAt: new Date("2026-10-18T10:00:00.000Z"),
    },
  ],
  nextCursor: "next",
};

function requireUser(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
}

function fakeNotifications() {
  return {
    listNotifications: vi.fn(async (actor: Actor, input?: ListNotificationsInput) => {
      requireUser(actor);
      if (input?.cursor === "bad") {
        throw new NotificationValidationError([
          { path: "cursor", message: "The cursor is not valid." },
        ]);
      }
      return samplePage;
    }),
    unreadCount: vi.fn(async (actor: Actor) => {
      requireUser(actor);
      return 3;
    }),
    markRead: vi.fn(async (actor: Actor, _input: MarkReadInput) => {
      requireUser(actor);
      return { unreadCount: 2 };
    }),
    markAllRead: vi.fn(async (actor: Actor) => {
      requireUser(actor);
      return { unreadCount: 0 };
    }),
    unreadCountsByCommunity: vi.fn(async (actor: Actor) => {
      requireUser(actor);
      return new Map<string, number>();
    }),
  } satisfies NotificationsService;
}

let notifications: ReturnType<typeof fakeNotifications>;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  notifications = fakeNotifications();
  const communities = createCommunitiesService(createFakeRepository());
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
  });
  api = createApi(() => apiDeps({ resolveSession, communities, posts, notifications }));
});

function call(
  path: string,
  init: { method?: string; signedIn?: boolean; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.signedIn !== false) headers.set(sessionHeader, userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.request(`/api/v1/notifications${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("GET /api/v1/notifications", () => {
  it("returns the caller's page with ISO dates and passes the cursor through", async () => {
    const response = await call("?cursor=abc&limit=5");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ ...samplePage.data[0], createdAt: "2026-10-18T10:00:00.000Z" }],
      nextCursor: "next",
    });
    expect(notifications.listNotifications).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      { cursor: "abc", limit: 5 },
    );
  });

  it("answers 401 with the error envelope for a guest", async () => {
    const response = await call("", { signedIn: false });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthenticated");
  });

  it("answers 422 for a limit out of range", async () => {
    const response = await call("?limit=500");

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("answers 422 for a cursor the service rejects", async () => {
    const response = await call("?cursor=bad");

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });
});

describe("GET /api/v1/notifications/unread-count", () => {
  it("returns the unread count", async () => {
    const response = await call("/unread-count");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unreadCount: 3 });
  });

  it("answers 401 for a guest", async () => {
    expect((await call("/unread-count", { signedIn: false })).status).toBe(401);
  });
});

describe("POST /api/v1/notifications/read", () => {
  it("marks the given ids read and returns the unread count", async () => {
    const response = await call("/read", { method: "POST", body: { ids: [notificationId] } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unreadCount: 2 });
    expect(notifications.markRead).toHaveBeenCalledWith(expect.anything(), {
      ids: [notificationId],
    });
  });

  it("answers 422 for ids that are not UUIDs", async () => {
    const response = await call("/read", { method: "POST", body: { ids: ["nope"] } });

    expect(response.status).toBe(422);
    expect(notifications.markRead).not.toHaveBeenCalled();
  });

  it("answers 422 for an empty id list", async () => {
    expect((await call("/read", { method: "POST", body: { ids: [] } })).status).toBe(422);
  });

  it("answers 401 for a guest", async () => {
    const response = await call("/read", {
      method: "POST",
      signedIn: false,
      body: { ids: [notificationId] },
    });

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/notifications/read-all", () => {
  it("marks everything read and returns the unread count", async () => {
    const response = await call("/read-all", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unreadCount: 0 });
  });

  it("answers 401 for a guest", async () => {
    expect((await call("/read-all", { method: "POST", signedIn: false })).status).toBe(401);
  });
});

describe("notifications OpenAPI", () => {
  it("documents the four notification operations", () => {
    const paths = createOpenApiDocument().paths ?? {};

    expect(paths["/api/v1/notifications"]?.get?.operationId).toBe("listNotifications");
    expect(paths["/api/v1/notifications/unread-count"]?.get?.operationId).toBe(
      "getNotificationUnreadCount",
    );
    expect(paths["/api/v1/notifications/read"]?.post?.operationId).toBe("markNotificationsRead");
    expect(paths["/api/v1/notifications/read-all"]?.post?.operationId).toBe(
      "markAllNotificationsRead",
    );
  });
});
