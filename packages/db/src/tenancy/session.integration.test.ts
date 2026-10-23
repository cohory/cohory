import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { openTestDb } from "../test/fixtures";
import { readRlsSetting, withRlsFlags } from "./session";

const { db, close } = openTestDb();

afterAll(async () => {
  await close();
});

class Rollback extends Error {}

describe("withRlsFlags", () => {
  it("rethrows the statement error from fn when the aborted transaction refuses the reset", async () => {
    const outcome = db.transaction((tx) =>
      withRlsFlags(tx, ["payments_webhook"], () => tx.execute(sql`select 1 / 0`)),
    );

    await expect(outcome).rejects.toMatchObject({ cause: { code: "22012" } });
  });

  it("puts the flags back when fn fails on a transaction that is still usable", async () => {
    const after = await db
      .transaction(async (tx) => {
        await withRlsFlags(tx, ["payments_webhook"], () => Promise.reject(new Error("boom"))).catch(
          () => undefined,
        );
        throw new Rollback(await readRlsSetting(tx, "payments_webhook"));
      })
      .catch((error: unknown) => (error instanceof Rollback ? error.message : "unexpected"));

    expect(after).toBe("");
  });

  it("turns the flags on for fn and off again afterwards", async () => {
    const seen = await db
      .transaction(async (tx) => {
        const during = await withRlsFlags(tx, ["payments_webhook"], () =>
          readRlsSetting(tx, "payments_webhook"),
        );
        throw new Rollback(`${during}|${await readRlsSetting(tx, "payments_webhook")}`);
      })
      .catch((error: unknown) => (error instanceof Rollback ? error.message : "unexpected"));

    expect(seen).toBe("on|");
  });
});
