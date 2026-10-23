import { afterAll, describe, expect, it } from "vitest";

import { createPool, parseAdminDatabaseEnv } from "./index";
import { runMigrations } from "./migrations";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);

afterAll(async () => {
  await pool.end();
});

describe("runMigrations", () => {
  it("gives up with a lock timeout instead of queueing behind a long lock", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query('lock table drizzle."__drizzle_migrations" in access exclusive mode');

      const started = Date.now();
      await expect(runMigrations(pool, { lockTimeoutMs: 200 })).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "55P03" }),
      });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("leaves the session lock timeout as it was once it finishes", async () => {
    await runMigrations(pool, { lockTimeoutMs: 200 });

    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ lock_timeout: string }>("show lock_timeout");
      expect(rows[0]?.lock_timeout).toBe("0");
    } finally {
      client.release();
    }
  });
});
