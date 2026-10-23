import { describe, expect, it } from "vitest";

import { parseWorkerEnv } from "./env";

const databaseUrl = "postgres://cohory:cohory@localhost:5433/cohory";

describe("parseWorkerEnv", () => {
  it("reads the public origin from APP_URL at runtime", () => {
    const env = parseWorkerEnv({
      DATABASE_URL: databaseUrl,
      APP_URL: "https://community.example.com/",
      BETTER_AUTH_URL: "https://other.example.com",
    });
    expect(env.appUrl).toBe("https://community.example.com");
  });

  it("falls back to BETTER_AUTH_URL when APP_URL is blank", () => {
    const env = parseWorkerEnv({
      DATABASE_URL: databaseUrl,
      APP_URL: "",
      BETTER_AUTH_URL: "http://127.0.0.1:3920",
    });
    expect(env.appUrl).toBe("http://127.0.0.1:3920");
  });

  it("ignores the build time NEXT_PUBLIC_APP_URL", () => {
    const env = parseWorkerEnv({
      DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_APP_URL: "https://baked.example.com",
    });
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("writes the heartbeat to the default file unless WORKER_HEARTBEAT_FILE is set", () => {
    expect(parseWorkerEnv({ DATABASE_URL: databaseUrl }).heartbeatFile).toBe(
      "/tmp/cohory-worker.heartbeat",
    );
    expect(
      parseWorkerEnv({ DATABASE_URL: databaseUrl, WORKER_HEARTBEAT_FILE: "/data/beat" })
        .heartbeatFile,
    ).toBe("/data/beat");
  });

  it("polls the notifications fanout queue every 2 seconds unless WORKER_FANOUT_POLL_SECONDS is set", () => {
    expect(parseWorkerEnv({ DATABASE_URL: databaseUrl }).fanoutPollSeconds).toBe(2);
    expect(
      parseWorkerEnv({ DATABASE_URL: databaseUrl, WORKER_FANOUT_POLL_SECONDS: "" })
        .fanoutPollSeconds,
    ).toBe(2);
    expect(
      parseWorkerEnv({ DATABASE_URL: databaseUrl, WORKER_FANOUT_POLL_SECONDS: "0.5" })
        .fanoutPollSeconds,
    ).toBe(0.5);
  });

  it("rejects a fanout poll interval pg-boss cannot use", () => {
    for (const value of ["0.1", "abc", "120"]) {
      expect(() =>
        parseWorkerEnv({ DATABASE_URL: databaseUrl, WORKER_FANOUT_POLL_SECONDS: value }),
      ).toThrow();
    }
  });
});
