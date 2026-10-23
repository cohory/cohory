import { afterEach, describe, expect, it } from "vitest";

import { createPool, createQueuePool, setPoolRole } from "./client";
import { parsePoolEnv } from "./env";

const url = "postgres://cohory:cohory@localhost:5433/cohory";
const settings = parsePoolEnv({
  DB_POOL_MAX: "7",
  DB_CONNECTION_TIMEOUT_MS: "2500",
  DB_STATEMENT_TIMEOUT_MS: "45000",
  DB_IDLE_IN_TX_TIMEOUT_MS: "30000",
  PGBOSS_POOL_MAX: "2",
});

const pools: { end(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe("createPool", () => {
  it("applies the size limit and the server side timeouts", () => {
    const pool = createPool(url, settings);
    pools.push(pool);

    expect(pool.options).toMatchObject({
      max: 7,
      connectionTimeoutMillis: 2500,
      statement_timeout: 45_000,
      idle_in_transaction_session_timeout: 30_000,
    });
  });

  it("keeps the statement timeout off when a caller disables it", () => {
    const pool = createPool(url, { ...settings, statementTimeoutMs: 0 });
    pools.push(pool);

    expect(pool.options.statement_timeout).toBe(0);
  });
});

describe("setPoolRole", () => {
  afterEach(() => {
    setPoolRole("web");
  });

  it("drops the statement timeout from pools a worker creates with the defaults", () => {
    const previous = process.env.DB_STATEMENT_TIMEOUT_MS;
    delete process.env.DB_STATEMENT_TIMEOUT_MS;
    try {
      const web = createPool(url);
      setPoolRole("worker");
      const worker = createPool(url);
      pools.push(web, worker);

      expect(web.options.statement_timeout).toBe(60_000);
      expect(worker.options.statement_timeout).toBe(0);
    } finally {
      if (previous !== undefined) {
        process.env.DB_STATEMENT_TIMEOUT_MS = previous;
      }
    }
  });
});

describe("createQueuePool", () => {
  it("uses the small queue limit with the same timeouts", () => {
    const pool = createQueuePool(url, settings);
    pools.push(pool);

    expect(pool.options).toMatchObject({
      max: 2,
      connectionTimeoutMillis: 2500,
      statement_timeout: 45_000,
    });
  });
});
