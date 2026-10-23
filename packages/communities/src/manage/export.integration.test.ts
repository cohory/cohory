import { ForbiddenError } from "@cohory/authz";
import { memberships, memberStats, users } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditActions,
  insertCast,
  insertMember,
  insertMembers,
  openManageHarness,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness({ now: () => new Date("2026-10-18T12:00:00Z") });
});

afterAll(async () => {
  await h.close();
});

async function read(body: ReadableStream<Uint8Array>): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    await new Response(body).arrayBuffer(),
  );
}

describe("exportMembersCsv", () => {
  it("streams exactly this community's members with a BOM, header, and audit entry", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await insertMember(h.admin, cast.communityId, "member", "banned", 'Quote "Q" Person');
    await h.admin
      .update(users)
      .set({ name: "=HYPERLINK(1)" })
      .where(eq(users.id, cast.member.userId));
    await h.admin.insert(memberStats).values({
      communityId: cast.communityId,
      userId: cast.member.userId,
      pointsTotal: 42,
      level: 3,
      updatedAt: new Date(),
    });

    const result = await h.service.exportMembersCsv(cast.owner, cast.communityId);
    const text = await read(result.body);

    expect(result.filename).toBe(`${cast.slug}-members-2026-10-18.csv`);
    expect(text.startsWith("﻿email,name,username,role,joined_at,level,points,status,")).toBe(true);
    const lines = text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(1 + 5);
    expect(text).toContain('"Quote ""Q"" Person"');
    expect(text).toContain("'=HYPERLINK(1)");
    expect(lines.find((line) => line.includes("HYPERLINK"))).toMatch(
      /,member,[^,]+,3,42,active,,,[^,]+,none,no$/,
    );
    for (const outsider of [other.owner, other.member, cast.outsider]) {
      const [row] = await h.admin
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, outsider.userId));
      expect(text).not.toContain(row?.email);
    }
    expect(await auditActions(h.admin, cast.communityId)).toContain("export.members_csv");
  });

  it("pages through more members than one batch", async () => {
    const cast = await insertCast(h.admin);
    await insertMembers(h.admin, cast.communityId, 520);

    const text = await read((await h.service.exportMembersCsv(cast.owner, cast.communityId)).body);

    expect(text.trimEnd().split("\r\n")).toHaveLength(1 + 4 + 520);
  }, 30_000);

  it("exports only the filtered members with their last active time and audits the filters", async () => {
    const cast = await insertCast(h.admin);
    const lurker = await insertMember(h.admin, cast.communityId, "member", "active", "Lurker");
    await h.admin
      .update(memberships)
      .set({ lastSeenAt: new Date("2026-05-01T00:00:00.000Z") })
      .where(
        and(eq(memberships.communityId, cast.communityId), eq(memberships.userId, lurker.userId)),
      );
    await h.admin
      .update(memberships)
      .set({ joinedAt: new Date("2026-01-01T00:00:00.000Z"), lastSeenAt: null })
      .where(
        and(
          eq(memberships.communityId, cast.communityId),
          sql`${memberships.userId} <> ${lurker.userId}`,
        ),
      );
    await h.admin.execute(
      sql`insert into sessions (id, user_id, token, expires_at, updated_at) select gen_random_uuid(), user_id, gen_random_uuid()::text, now() + interval '1 day', '2026-10-17T00:00:00Z' from memberships where community_id = ${cast.communityId} and user_id <> ${lurker.userId}`,
    );

    const result = await h.service.exportMembersCsv(cast.owner, cast.communityId, {
      inactiveDays: 30,
    });
    const lines = (await read(result.body)).trimEnd().split("\r\n");

    expect(lines[0]?.endsWith(",stripe_subscription_id,last_active_at,access,signed_in")).toBe(
      true,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/,Lurker,.*,active,,,2026-05-01T00:00:00\.000Z,none,no$/);
    const [entry] = await h.admin
      .execute<{ metadata: unknown }>(
        sql`select metadata from audit_log where community_id = ${cast.communityId} and action = 'export.members_csv'`,
      )
      .then((r) => r.rows);
    expect(entry?.metadata).toEqual({ filters: { inactiveDays: 30, status: "active" } });
  });

  it("adds each member's access and filters by it", async () => {
    const cast = await insertCast(h.admin);
    const paid = await openManageHarness({
      now: () => new Date("2026-10-18T12:00:00Z"),
      memberAccess: {
        list: async () =>
          new Map([[cast.member.userId, { access: "paying_yearly" as const, until: null }]]),
      },
    });
    try {
      const all = await read(
        (await paid.service.exportMembersCsv(cast.owner, cast.communityId)).body,
      );
      const paying = await read(
        (
          await paid.service.exportMembersCsv(cast.owner, cast.communityId, {
            access: "paying_yearly",
          })
        ).body,
      );

      const allLines = all.trimEnd().split("\r\n");
      expect(allLines.filter((line) => line.endsWith(",paying_yearly,no"))).toHaveLength(1);
      expect(allLines.filter((line) => line.endsWith(",none,no"))).toHaveLength(3);
      const payingLines = paying.trimEnd().split("\r\n");
      expect(payingLines).toHaveLength(2);
      expect(payingLines[1]).toContain(",Member,");
    } finally {
      await paid.close();
    }
  });

  it("rejects invalid filters before exporting", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.exportMembersCsv(cast.owner, cast.communityId, { inactiveDays: -1 }),
    ).rejects.toThrow();
  });

  it.each(["admin", "moderator", "member", "outsider"] as const)("refuses a %s", async (role) => {
    const cast = await insertCast(h.admin, "public");
    await expect(h.service.exportMembersCsv(cast[role], cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
