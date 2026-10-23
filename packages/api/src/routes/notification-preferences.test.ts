import { UnauthenticatedError, type Actor } from "@cohory/authz";
import { createCommunitiesService } from "@cohory/communities";
import { createFakeRepository } from "@cohory/communities/testing";
import {
  createUnsubscribeToken,
  resolvePreferences,
  type NotificationPreferences,
  type PreferencesService,
  type UpdatePreferencesInput,
  verifyUnsubscribeToken,
} from "@cohory/notifications";
import { createPostsService } from "@cohory/posts";
import { createFakePostsRepository } from "@cohory/posts/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDeps } from "../services";

import { createApi } from "../app";
import type { SessionResolver } from "../middleware/session";

const sessionHeader = "x-test-user";
const resolveSession: SessionResolver = async (headers) => {
  const userId = headers.get(sessionHeader);
  return userId ? { userId } : null;
};

const userId = "0192f0a0-0000-7000-8000-00000000000a";
const secret = "route-test-secret-that-is-at-least-32-chars";

function requireUser(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
}

function fakePreferences() {
  const readUnsubscribeToken = (token: string) => verifyUnsubscribeToken(secret, token);
  let saved: NotificationPreferences = resolvePreferences([], null);
  return {
    getPreferences: vi.fn(async (actor: Actor) => {
      requireUser(actor);
      return saved;
    }),
    updatePreferences: vi.fn(async (actor: Actor, input: UpdatePreferencesInput) => {
      requireUser(actor);
      saved = {
        ...saved,
        digestHour: input.digestHour ?? saved.digestHour,
        weeklyDigest: input.weeklyDigest ?? saved.weeklyDigest,
      };
      return saved;
    }),
    readUnsubscribeToken,
    unsubscribe: vi.fn(async (token: string) => {
      const claim = readUnsubscribeToken(token);
      return claim ? { scope: claim.scope, label: "mentions" } : null;
    }),
  } satisfies PreferencesService;
}

let preferences: ReturnType<typeof fakePreferences>;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  preferences = fakePreferences();
  const communities = createCommunitiesService(createFakeRepository());
  const posts = createPostsService({
    repo: createFakePostsRepository(),
    storage: {
      put: async (input) => ({ ...input, contentType: "image/png", size: 0 }),
      publicUrl: (key) => key,
    },
  });
  api = createApi(() => apiDeps({ resolveSession, communities, posts, preferences }));
});

function call(
  path: string,
  init: { method?: string; signedIn?: boolean; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.signedIn !== false) headers.set(sessionHeader, userId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.request(`/api/v1/notification-preferences${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

describe("notification preferences routes", () => {
  it("returns the defaults to a signed in member", async () => {
    const response = await call("");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      types: [
        { type: "mention", inApp: true, email: "immediate" },
        { type: "reply", inApp: true, email: "immediate" },
        { type: "comment_on_post", inApp: true, email: "daily" },
        { type: "join_request", inApp: true, email: "immediate" },
        { type: "join_request_approved", inApp: true, email: "immediate" },
        { type: "join_request_declined", inApp: true, email: "immediate" },
        { type: "approval_request", inApp: true, email: "immediate" },
        { type: "agent_access", inApp: true, email: "immediate" },
        { type: "report_actioned", inApp: true, email: "off" },
        { type: "report_dismissed", inApp: true, email: "off" },
        { type: "review_created", inApp: true, email: "immediate" },
        { type: "member_joined", inApp: true, email: "daily" },
        { type: "like_on_post", inApp: true, email: "off" },
        { type: "like_on_comment", inApp: true, email: "off" },
        { type: "report_created", inApp: true, email: "off" },
        { type: "paid_member_joined", inApp: true, email: "off" },
        { type: "paid_member_canceled", inApp: true, email: "off" },
        { type: "event_created", inApp: true, email: "off" },
        { type: "event_reminder", inApp: true, email: "immediate" },
        { type: "comment_on_followed_post", inApp: true, email: "daily" },
      ],
      digestHour: 8,
      timeZone: "UTC",
      weeklyDigest: true,
    });
  });

  it("turns the weekly digest off", async () => {
    const response = await call("", { method: "PUT", body: { weeklyDigest: false } });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { weeklyDigest: boolean }).weeklyDigest).toBe(false);
  });

  it("answers 401 to a guest for reads and writes", async () => {
    expect((await call("", { signedIn: false })).status).toBe(401);
    expect(
      (await call("", { method: "PUT", signedIn: false, body: { digestHour: 7 } })).status,
    ).toBe(401);
  });

  it("saves a change and passes the parsed body to the service", async () => {
    const response = await call("", { method: "PUT", body: { digestHour: 7 } });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { digestHour: number }).digestHour).toBe(7);
    expect(preferences.updatePreferences).toHaveBeenCalledWith(
      { kind: "user", userId, platformAdmin: false },
      { digestHour: 7 },
    );
  });

  it("rejects an email mode that does not exist", async () => {
    const response = await call("", {
      method: "PUT",
      body: { types: [{ type: "reply", inApp: true, email: "weekly" }] },
    });

    expect(response.status).toBe(422);
  });

  it("unsubscribes with a valid token and no session", async () => {
    const token = createUnsubscribeToken(secret, { userId, scope: "mention" });

    const response = await call(`/unsubscribe?token=${token}`, { method: "POST", signedIn: false });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scope: "mention", label: "mentions" });
  });

  it("answers 422 to a forged unsubscribe token", async () => {
    const token = createUnsubscribeToken(`${secret}-other`, { userId, scope: "mention" });

    const response = await call(`/unsubscribe?token=${token}`, { method: "POST", signedIn: false });

    expect(response.status).toBe(422);
  });
});
