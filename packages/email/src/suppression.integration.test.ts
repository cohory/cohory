import { createDb, createPool, newId, parseAdminDatabaseEnv } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { communities, emailLog, emailSuppressions } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogMailer } from "./drivers/log";
import { createDbEmailLog, hashEmailAddress, withEmailLog } from "./log";
import { createDbSuppressionList, withSuppression } from "./suppression";
import { passwordResetEmail } from "./templates/password-reset";

const probeRole = "cohory_email_suppression_probe";
const adminPool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const admin = createDb(adminPool);
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probe = createDb(probePool);
const list = createDbSuppressionList(() => probe);

beforeAll(async () => {
  await admin.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${probeRole};
        grant select, insert, delete on email_suppressions to ${probeRole};
        grant select, insert on email_log to ${probeRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await adminPool.end();
});

async function insertCommunity(): Promise<string> {
  const [row] = await admin
    .insert(communities)
    .values({ slug: `sup-${newId().slice(-12)}`, name: "Suppression test" })
    .returning({ id: communities.id });
  if (!row) throw new Error("community insert returned no row");
  return row.id;
}

function uniqueHash(): string {
  return hashEmailAddress(`sup-${newId()}@example.com`);
}

describe("createDbSuppressionList", () => {
  it("records an instance wide bounce once and finds it for any community", async () => {
    const addressHash = uniqueHash();
    const communityId = await insertCommunity();

    await list.suppress({ addressHash, communityId: null, reason: "hard_bounce", source: "smtp" });
    await list.suppress({ addressHash, communityId: null, reason: "complaint", source: "webhook" });

    expect(await list.suppressionReason({ addressHash })).toBe("hard_bounce");
    expect(await list.isSuppressed({ addressHash, communityId })).toBe(true);
    const rows = await admin
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.addressHash, addressHash));
    expect(rows).toHaveLength(1);
  });

  it("limits an opt out to its community", async () => {
    const addressHash = uniqueHash();
    const optedOut = await insertCommunity();
    const other = await insertCommunity();

    await list.suppress({
      addressHash,
      communityId: optedOut,
      reason: "opt_out",
      source: "member",
    });

    expect(await list.isSuppressed({ addressHash, communityId: optedOut })).toBe(true);
    expect(await list.isSuppressed({ addressHash, communityId: other })).toBe(false);
    expect(await list.isSuppressed({ addressHash })).toBe(false);
  });

  it("lifts only the scope an operator names", async () => {
    const addressHash = uniqueHash();
    const communityId = await insertCommunity();
    await list.suppress({ addressHash, communityId: null, reason: "manual", source: "operator" });
    await list.suppress({ addressHash, communityId, reason: "opt_out", source: "member" });

    expect(await list.lift({ addressHash, communityId: null })).toBe(1);

    expect(await list.isSuppressed({ addressHash })).toBe(false);
    expect(await list.isSuppressed({ addressHash, communityId })).toBe(true);
  });

  it("logs a skipped send as suppressed and still sends a password reset", async () => {
    const address = `sup-${newId()}@example.com`;
    const addressHash = hashEmailAddress(address);
    const log = createDbEmailLog(() => probe);
    const driver = createLogMailer({ log: () => undefined });
    const mailer = withSuppression(withEmailLog(driver, log), { list, log });
    await list.suppress({ addressHash, communityId: null, reason: "complaint", source: "webhook" });

    await mailer.send({
      to: address,
      subject: "Hello",
      text: "text",
      html: "<p>html</p>",
      template: "notification",
    });
    await mailer.send({
      to: address,
      ...passwordResetEmail({ name: "Ada", url: "https://example.com/r", expiresInMinutes: 60 }),
    });

    expect(driver.sent.map((sent) => sent.template)).toEqual(["password-reset"]);
    const rows = await admin
      .select({
        template: emailLog.template,
        status: emailLog.status,
        errorCode: emailLog.errorCode,
      })
      .from(emailLog)
      .where(eq(emailLog.recipientHash, addressHash));
    expect(rows).toEqual(
      expect.arrayContaining([
        { template: "notification", status: "suppressed", errorCode: "complaint" },
        { template: "password-reset", status: "sent", errorCode: null },
      ]),
    );
  });
});
