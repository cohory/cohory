import { describe, expect, it, vi } from "vitest";

import type { HeartbeatCheck } from "./heartbeat";
import { runHealthcheck } from "./healthcheck";

function deps(check: HeartbeatCheck) {
  return {
    check: vi.fn(() => check),
    kill: vi.fn(),
    log: vi.fn(),
  };
}

describe("runHealthcheck", () => {
  it("exits 0 when the heartbeat is fresh", () => {
    const d = deps({ healthy: true, pid: 7 });
    expect(runHealthcheck([], d)).toBe(0);
    expect(d.kill).not.toHaveBeenCalled();
  });

  it("exits 1 without stopping the worker when the heartbeat is stale", () => {
    const d = deps({ healthy: false, pid: 7, reason: "stale" });
    expect(runHealthcheck([], d)).toBe(1);
    expect(d.kill).not.toHaveBeenCalled();
  });

  it("stops a stale worker with --restart so the restart policy starts a new one", () => {
    const d = deps({ healthy: false, pid: 7, reason: "stale" });
    expect(runHealthcheck(["--restart"], d)).toBe(1);
    expect(d.kill).toHaveBeenCalledWith(7, "SIGKILL");
  });

  it("does not stop anything when no heartbeat was ever written", () => {
    const d = deps({ healthy: false, pid: null, reason: "missing" });
    expect(runHealthcheck(["--restart"], d)).toBe(1);
    expect(d.kill).not.toHaveBeenCalled();
  });

  it("never signals process 1, which ignores SIGKILL from inside its container", () => {
    const d = deps({ healthy: false, pid: 1, reason: "stale" });
    expect(runHealthcheck(["--restart"], d)).toBe(1);
    expect(d.kill).not.toHaveBeenCalled();
  });
});
