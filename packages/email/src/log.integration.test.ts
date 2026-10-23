import { createDb, createPool, parseAdminDatabaseEnv } from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { emailLog } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogMailer } from "./drivers/log";
import { createDbEmailLog, hashEmailAddress, withEmailLog } from "./log";

const probeRole = "cohory_email_log_probe";
const adminPool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const admin = createDb(adminPool);
const probeUrl = new URL(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
probeUrl.searchParams.set("options", `-c role=${probeRole}`);
const probePool = createPool(probeUrl.toString());
const probe = createDb(probePool);

beforeAll(async () => {
  await admin.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${migrationLockKey})`));
    await tx.execute(
      sql.raw(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
          create role ${probeRole} nologin nosuperuser nobypassrls;
        end if;
        grant usage on schema public to ${probeRole};
        grant select, insert on email_log to ${probeRole};
      end $$`),
    );
  });
});

afterAll(async () => {
  await probePool.end();
  await adminPool.end();
});

describe("createDbEmailLog", () => {
  it("writes the send log through row level security as a role without bypass", async () => {
    const address = `log-${crypto.randomUUID()}@example.test`;
    const mailer = withEmailLog(
      createLogMailer({ log: () => undefined }),
      createDbEmailLog(() => probe),
      (error) => {
        throw error;
      },
    );

    await mailer.send({
      to: address,
      subject: "Test email",
      text: "text",
      html: "<p>html</p>",
      template: "test",
    });

    const rows = await admin
      .select()
      .from(emailLog)
      .where(eq(emailLog.recipientHash, hashEmailAddress(address)));
    expect(rows).toMatchObject([{ template: "test", status: "sent", errorCode: null }]);
  });
});
