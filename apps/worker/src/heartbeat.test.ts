import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHeartbeat, readHeartbeat, startHeartbeat } from "./heartbeat";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cohory-heartbeat-"));
  file = join(dir, "worker.heartbeat");
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("startHeartbeat", () => {
  it("writes the process id and the time after a successful database probe", async () => {
    const probe = vi.fn(() => Promise.resolve());
    const heartbeat = startHeartbeat({
      file,
      intervalMs: 1_000,
      probe,
      pid: 42,
      now: () => new Date("2026-10-19T10:00:00.000Z"),
    });
    await heartbeat.beat();
    heartbeat.stop();

    expect(probe).toHaveBeenCalled();
    expect(readHeartbeat(file)).toEqual({ pid: 42, at: "2026-10-19T10:00:00.000Z" });
  });

  it("leaves the previous beat in place when the database probe fails", async () => {
    writeFileSync(file, JSON.stringify({ pid: 42, at: "2026-10-19T09:00:00.000Z" }));
    const onProbeError = vi.fn();
    const heartbeat = startHeartbeat({
      file,
      intervalMs: 1_000,
      probe: () => Promise.reject(new Error("connection refused")),
      onProbeError,
      pid: 42,
      now: () => new Date("2026-10-19T10:00:00.000Z"),
    });
    await heartbeat.beat();
    heartbeat.stop();

    expect(onProbeError).toHaveBeenCalledWith(expect.any(Error));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      pid: 42,
      at: "2026-10-19T09:00:00.000Z",
    });
  });
});

describe("checkHeartbeat", () => {
  const now = () => new Date("2026-10-19T10:01:00.000Z");

  it("is healthy when the last beat is younger than the limit", () => {
    writeFileSync(file, JSON.stringify({ pid: 42, at: "2026-10-19T10:00:30.000Z" }));
    expect(checkHeartbeat({ file, maxAgeMs: 60_000, now })).toEqual({ healthy: true, pid: 42 });
  });

  it("is unhealthy when the last beat is older than the limit", () => {
    writeFileSync(file, JSON.stringify({ pid: 42, at: "2026-10-19T09:59:00.000Z" }));
    expect(checkHeartbeat({ file, maxAgeMs: 60_000, now })).toEqual({
      healthy: false,
      pid: 42,
      reason: "stale",
    });
  });

  it("is unhealthy when the worker never wrote a beat", () => {
    expect(checkHeartbeat({ file, maxAgeMs: 60_000, now })).toEqual({
      healthy: false,
      pid: null,
      reason: "missing",
    });
  });

  it("is unhealthy when the file does not hold a beat", () => {
    writeFileSync(file, "not json");
    expect(checkHeartbeat({ file, maxAgeMs: 60_000, now })).toEqual({
      healthy: false,
      pid: null,
      reason: "missing",
    });
  });
});
