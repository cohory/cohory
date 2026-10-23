import { describe, expect, it } from "vitest";

import { assertTestDatabase, maintenanceUrl, testDatabaseName } from "./test-database";

describe("assertTestDatabase", () => {
  it("refuses the development database on local port 5433", () => {
    expect(() => assertTestDatabase("postgres://cohory:cohory@127.0.0.1:5433/cohory", {})).toThrow(
      /development database/,
    );
    expect(() => assertTestDatabase("postgres://cohory:cohory@localhost:5433/other", {})).toThrow(
      /development database/,
    );
  });

  it("allows port 5433 in CI, where it is a throwaway service container", () => {
    expect(() =>
      assertTestDatabase("postgres://cohory:cohory@localhost:5433/cohory", { CI: "true" }),
    ).not.toThrow();
  });

  it("allows port 5433 when the run opts in explicitly", () => {
    expect(() =>
      assertTestDatabase("postgres://cohory:cohory@127.0.0.1:5433/cohory", {
        COHORY_TEST_ALLOW_DEV_DB: "1",
      }),
    ).not.toThrow();
  });

  it("allows the shared test services stack and throwaway containers", () => {
    expect(() =>
      assertTestDatabase("postgres://cohory:cohory@127.0.0.1:55432/cohory_test_main_abc123", {}),
    ).not.toThrow();
    expect(() =>
      assertTestDatabase("postgres://cohory:cohory@127.0.0.1:55310/cohory", {}),
    ).not.toThrow();
  });
});

describe("testDatabaseName", () => {
  it("reads the database name from the URL", () => {
    expect(testDatabaseName("postgres://cohory:cohory@127.0.0.1:55432/cohory_test_z5_ab12cd")).toBe(
      "cohory_test_z5_ab12cd",
    );
  });

  it("rejects names that would need quoting", () => {
    expect(() => testDatabaseName('postgres://cohory@127.0.0.1:55432/a";drop')).toThrow(
      /database name/,
    );
    expect(() => testDatabaseName("postgres://cohory@127.0.0.1:55432/")).toThrow(/database name/);
  });
});

describe("maintenanceUrl", () => {
  it("points at the postgres database on the same server with the same credentials", () => {
    expect(
      maintenanceUrl("postgres://cohory:secret@127.0.0.1:55432/cohory_test_x?sslmode=disable"),
    ).toBe("postgres://cohory:secret@127.0.0.1:55432/postgres?sslmode=disable");
  });
});
