import type * as AuthzModule from "@cohory/authz";
import { createDb, createPool } from "@cohory/db";
import { afterAll, describe, expect, it, vi } from "vitest";

const authz = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@cohory/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthzModule>();
  return {
    ...actual,
    assertCan: (...args: Parameters<typeof actual.assertCan>) => {
      authz.calls.push(args);
      return actual.assertCan(...args);
    },
  };
});

const { createNotificationsService } = await import("./service");
const { createPreferencesService } = await import("./preferences-service");

const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
const db = createDb(pool);
const notifications = createNotificationsService({ db });
const preferences = createPreferencesService({
  db,
  secret: "a-test-secret-that-is-at-least-32-characters",
});
const actor = {
  kind: "user",
  userId: "0192f0a0-0000-7000-8000-000000000001",
  platformAdmin: false,
} as const;
const notificationId = "0192f0a0-0000-7000-8000-000000000002";

afterAll(async () => {
  await pool.end();
});

describe("notification and preference services check the policy matrix", () => {
  it.each([
    ["listNotifications", "read", "notification", () => notifications.listNotifications(actor)],
    ["unreadCount", "read", "notification", () => notifications.unreadCount(actor)],
    [
      "markRead",
      "mark_read",
      "notification",
      () => notifications.markRead(actor, { ids: [notificationId] }),
    ],
    ["markAllRead", "mark_read", "notification", () => notifications.markAllRead(actor)],
    ["getPreferences", "update_own", "account", () => preferences.getPreferences(actor)],
    [
      "updatePreferences",
      "update_own",
      "account",
      () => preferences.updatePreferences(actor, { digestHour: 9 }),
    ],
  ])("%s asserts %s on %s", async (_name, action, resource, call) => {
    authz.calls.length = 0;
    await call().catch(() => undefined);
    expect(authz.calls).toContainEqual([actor, action, resource]);
  });

  it("refuses guests before the policy check", async () => {
    await expect(notifications.markAllRead({ kind: "guest" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
