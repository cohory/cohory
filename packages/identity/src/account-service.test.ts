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

const { createAccountService } = await import("./account-service");

const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
const service = createAccountService({ db: createDb(pool) });
const actor = {
  kind: "user",
  userId: "0192f0a0-0000-7000-8000-000000000001",
  platformAdmin: false,
} as const;

afterAll(async () => {
  await pool.end();
});

describe("account service authorization", () => {
  it.each([
    ["ownedCommunities", () => service.ownedCommunities(actor)],
    ["deletionStatus", () => service.deletionStatus(actor)],
    ["requestDeletion", () => service.requestDeletion(actor, { confirmation: "x" })],
    ["cancelDeletion", () => service.cancelDeletion(actor)],
    ["listSessions", () => service.listSessions(actor, "s")],
    ["revokeSession", () => service.revokeSession(actor, "s")],
    ["revokeOtherSessions", () => service.revokeOtherSessions(actor, "s")],
  ])("%s asserts account.update_own before it reads anything", async (_name, call) => {
    authz.calls.length = 0;
    await call().catch(() => undefined);
    expect(authz.calls).toContainEqual([actor, "update_own", "account"]);
  });

  it("refuses guests", async () => {
    await expect(service.cancelDeletion({ kind: "guest" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
