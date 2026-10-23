import { describe, expect, it } from "vitest";

import { appRoleFromUrls } from "./app-role";
import { parseAdminDatabaseEnv, parseDatabaseEnv, parsePoolEnv } from "./env";

describe("parsePoolEnv", () => {
  it("bounds the pool and sets timeouts by default", () => {
    expect(parsePoolEnv({})).toEqual({
      max: 10,
      connectionTimeoutMs: 10_000,
      statementTimeoutMs: 60_000,
      idleInTransactionTimeoutMs: 60_000,
      queueMax: 3,
    });
  });

  it("reads each limit from the environment", () => {
    expect(
      parsePoolEnv({
        DB_POOL_MAX: "4",
        DB_CONNECTION_TIMEOUT_MS: "2000",
        DB_STATEMENT_TIMEOUT_MS: "0",
        DB_IDLE_IN_TX_TIMEOUT_MS: "15000",
        PGBOSS_POOL_MAX: "1",
      }),
    ).toEqual({
      max: 4,
      connectionTimeoutMs: 2000,
      statementTimeoutMs: 0,
      idleInTransactionTimeoutMs: 15_000,
      queueMax: 1,
    });
  });

  it("gives worker processes no statement timeout unless one is set", () => {
    expect(parsePoolEnv({}, "worker").statementTimeoutMs).toBe(0);
    expect(parsePoolEnv({ DB_STATEMENT_TIMEOUT_MS: "90000" }, "worker").statementTimeoutMs).toBe(
      90_000,
    );
    expect(parsePoolEnv({}, "worker")).toMatchObject({
      max: 10,
      idleInTransactionTimeoutMs: 60_000,
    });
  });

  it("treats blank values as unset", () => {
    expect(parsePoolEnv({ DB_POOL_MAX: "", PGBOSS_POOL_MAX: "" })).toMatchObject({
      max: 10,
      queueMax: 3,
    });
  });

  it("rejects a pool without connections or a negative timeout", () => {
    expect(() => parsePoolEnv({ DB_POOL_MAX: "0" })).toThrow();
    expect(() => parsePoolEnv({ PGBOSS_POOL_MAX: "0" })).toThrow();
    expect(() => parsePoolEnv({ DB_STATEMENT_TIMEOUT_MS: "-1" })).toThrow();
    expect(() => parsePoolEnv({ DB_POOL_MAX: "ten" })).toThrow();
  });
});

describe("parseDatabaseEnv", () => {
  it("accepts a postgres connection string", () => {
    const env = parseDatabaseEnv({
      DATABASE_URL: "postgres://cohory:cohory@localhost:5433/cohory",
    });

    expect(env.DATABASE_URL).toBe("postgres://cohory:cohory@localhost:5433/cohory");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseDatabaseEnv({})).toThrow();
  });

  it("rejects a non postgres URL", () => {
    expect(() => parseDatabaseEnv({ DATABASE_URL: "mysql://localhost/cohory" })).toThrow();
  });
});

describe("parseAdminDatabaseEnv", () => {
  it("falls back to DATABASE_URL when DATABASE_ADMIN_URL is unset", () => {
    const env = parseAdminDatabaseEnv({
      DATABASE_URL: "postgres://cohory_app:secret@localhost:5433/cohory",
    });

    expect(env.DATABASE_ADMIN_URL).toBe("postgres://cohory_app:secret@localhost:5433/cohory");
  });

  it("keeps both URLs when DATABASE_ADMIN_URL is set", () => {
    const env = parseAdminDatabaseEnv({
      DATABASE_URL: "postgres://cohory_app:secret@localhost:5433/cohory",
      DATABASE_ADMIN_URL: "postgres://cohory:cohory@localhost:5433/cohory",
    });

    expect(env.DATABASE_URL).toBe("postgres://cohory_app:secret@localhost:5433/cohory");
    expect(env.DATABASE_ADMIN_URL).toBe("postgres://cohory:cohory@localhost:5433/cohory");
  });

  it("rejects a non postgres DATABASE_ADMIN_URL", () => {
    expect(() =>
      parseAdminDatabaseEnv({
        DATABASE_URL: "postgres://cohory:cohory@localhost:5433/cohory",
        DATABASE_ADMIN_URL: "mysql://localhost/cohory",
      }),
    ).toThrow();
  });
});

describe("appRoleFromUrls", () => {
  it("returns null when app and admin connect as the same user", () => {
    const url = "postgres://cohory:cohory@localhost:5433/cohory";

    expect(appRoleFromUrls(url, url)).toBeNull();
  });

  it("extracts the decoded app role name and password", () => {
    const role = appRoleFromUrls(
      "postgres://cohory_app:p%40ss%2Fword@postgres:5432/cohory",
      "postgres://cohory:cohory@postgres:5432/cohory",
    );

    expect(role).toEqual({ name: "cohory_app", password: "p@ss/word" });
  });
});
