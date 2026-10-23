import { describe, expect, it, vi } from "vitest";

import { createApi } from "./app";
import { checkReadiness, missingConfig } from "./readiness";

const completeEnv = {
  DATABASE_URL: "postgres://cohory_app:secret@postgres:5432/cohory",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://community.example.com",
};

describe("missingConfig", () => {
  it("reports nothing when the required variables are set", () => {
    expect(missingConfig(completeEnv)).toEqual([]);
  });

  it("names each required variable that is missing or invalid", () => {
    expect(
      missingConfig({ DATABASE_URL: "mysql://nope", BETTER_AUTH_SECRET: "short" }).sort(),
    ).toEqual(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL"]);
  });

  it("applies the auth production rules for the placeholder secret and a plain http URL", () => {
    const production = { ...completeEnv, NODE_ENV: "production" };

    expect(
      missingConfig({
        ...production,
        BETTER_AUTH_SECRET: "change-me-to-a-random-string-of-32-characters",
      }),
    ).toEqual(["BETTER_AUTH_SECRET"]);
    expect(
      missingConfig({
        ...production,
        BETTER_AUTH_SECRET: "q8Vt2nR4xL7pK1sW9mZ3cB6yH0jF5gD2aN8eU4iO7wQ=",
        BETTER_AUTH_URL: "http://community.example.com",
      }),
    ).toEqual(["BETTER_AUTH_URL"]);
  });
});

describe("checkReadiness", () => {
  it("is ok when the configuration is complete and the database answers", async () => {
    const probe = vi.fn(() => Promise.resolve());
    await expect(checkReadiness({ env: completeEnv, probeDatabase: probe })).resolves.toEqual({
      status: "ok",
      checks: { config: "ok", database: "ok" },
    });
  });

  it("is degraded without touching the database when configuration is missing", async () => {
    const probe = vi.fn(() => Promise.resolve());
    const report = await checkReadiness({ env: {}, probeDatabase: probe });
    expect(report).toEqual({
      status: "degraded",
      checks: { config: "missing", database: "skipped" },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("is degraded when the database is unreachable", async () => {
    const report = await checkReadiness({
      env: completeEnv,
      probeDatabase: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });
    expect(report).toEqual({
      status: "degraded",
      checks: { config: "ok", database: "unreachable" },
    });
  });

  it("is degraded when the database does not answer in time", async () => {
    const report = await checkReadiness({
      env: completeEnv,
      probeDatabase: () => new Promise<void>(() => undefined),
      timeoutMs: 10,
    });
    expect(report.checks.database).toBe("unreachable");
  });
});

describe("GET /api/v1/health", () => {
  it("answers 503 with the failing checks when the app cannot serve", async () => {
    const app = createApi(
      () => {
        throw new Error("health must not build the service graph");
      },
      {
        readiness: () =>
          Promise.resolve({
            status: "degraded",
            checks: { config: "missing", database: "skipped" },
          }),
      },
    );
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      checks: { config: "missing", database: "skipped" },
    });
  });

  it("answers 200 when every check passes", async () => {
    const app = createApi(
      () => {
        throw new Error("health must not build the service graph");
      },
      {
        readiness: () =>
          Promise.resolve({ status: "ok", checks: { config: "ok", database: "ok" } }),
      },
    );
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/health/live", () => {
  it("answers ok without checking configuration or the database", async () => {
    const readiness = vi.fn();
    const app = createApi(
      () => {
        throw new Error("liveness must not build the service graph");
      },
      { readiness },
    );
    const response = await app.request("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(readiness).not.toHaveBeenCalled();
  });
});
