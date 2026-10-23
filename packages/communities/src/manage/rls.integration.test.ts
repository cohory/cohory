import type { Database } from "@cohory/db";
import { auditLog, inviteLinks } from "@cohory/db/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertCast, openManageHarness, type ManageHarness } from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function asApp<T>(
  settings: { community?: string; manager?: boolean; token?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return h.app.transaction(async (tx) => {
    const set = async (name: string, value: string | undefined) => {
      if (value) await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    };
    await set("app.community_id", settings.community);
    await set("app.community_manager", settings.manager ? "on" : undefined);
    await set("app.invite_token", settings.token);
    return fn(tx);
  });
}

describe("manage row level security", () => {
  it("is enabled and forced on invite_links and audit_log", async () => {
    const result = await h.admin.execute<{ relname: string; enabled: boolean; forced: boolean }>(
      sql`select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
          where relname in ('invite_links', 'audit_log') order by relname`,
    );
    expect(result.rows).toEqual([
      { relname: "audit_log", enabled: true, forced: true },
      { relname: "invite_links", enabled: true, forced: true },
    ]);
  });

  it("shows invite links only to managers of the community or to the holder of a token", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.createInviteLink(other.owner, other.communityId);

    const count = (rows: unknown[]) => rows.length;
    expect(count(await asApp({}, (tx) => tx.select().from(inviteLinks)))).toBe(0);
    expect(
      count(await asApp({ community: cast.communityId }, (tx) => tx.select().from(inviteLinks))),
    ).toBe(0);
    expect(
      count(
        await asApp({ community: cast.communityId, manager: true }, (tx) =>
          tx.select().from(inviteLinks),
        ),
      ),
    ).toBe(1);
    expect(count(await asApp({ token: invite.token }, (tx) => tx.select().from(inviteLinks)))).toBe(
      1,
    );
    expect(
      count(await asApp({ token: "not-a-token" }, (tx) => tx.select().from(inviteLinks))),
    ).toBe(0);
  });

  it("does not let a token holder raise the use count of a link in another community", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    const invite = await h.service.createInviteLink(cast.owner, cast.communityId);

    const updated = await asApp({ token: invite.token, community: other.communityId }, (tx) =>
      tx
        .update(inviteLinks)
        .set({ useCount: sql`${inviteLinks.useCount} + 1` })
        .returning(),
    );

    expect(updated).toEqual([]);
  });

  it("keeps the audit log append only and readable only by managers", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await h.service.archiveCommunity(cast.owner, cast.communityId);

    expect(
      await asApp({ community: cast.communityId }, (tx) => tx.select().from(auditLog)),
    ).toEqual([]);
    const visible = await asApp({ community: cast.communityId, manager: true }, (tx) =>
      tx.select().from(auditLog),
    );
    expect(visible.map((row) => row.action)).toEqual(["community.archived"]);

    const changed = await asApp({ community: cast.communityId, manager: true }, async (tx) => [
      ...(await tx.update(auditLog).set({ action: "tampered" }).returning()),
      ...(await tx.delete(auditLog).returning()),
    ]);
    expect(changed).toEqual([]);

    await expect(
      asApp({ community: cast.communityId }, (tx) =>
        tx.insert(auditLog).values({
          communityId: other.communityId,
          actorId: cast.owner.userId,
          action: "forged",
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
    });
  });
});
