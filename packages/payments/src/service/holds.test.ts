import { describe, expect, it, vi } from "vitest";

import type { DueHold, HoldRelease } from "../holds/store";
import { releaseEach } from "./holds";

const holds: DueHold[] = [
  { communityId: "01900000-0000-7000-8000-000000000001", userId: "u1" },
  { communityId: "01900000-0000-7000-8000-000000000001", userId: "u2" },
  { communityId: "01900000-0000-7000-8000-000000000002", userId: "u3" },
];

describe("releaseEach", () => {
  it("logs a hold that fails and goes on with the rest of the batch", async () => {
    const release = vi
      .fn<(hold: DueHold) => Promise<HoldRelease>>()
      .mockResolvedValueOnce("released")
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValueOnce("kept");
    const log = vi.fn();

    const result = await releaseEach(holds, release, vi.fn(), log);

    expect(release).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ released: 1, kept: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "membership hold release failed", userId: "u2" }),
    );
  });

  it("moves a hold that fails at the head of the batch behind the others for the next run", async () => {
    const release = vi
      .fn<(hold: DueHold) => Promise<HoldRelease>>()
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValue("released");
    const defer = vi.fn<(hold: DueHold) => Promise<void>>().mockResolvedValue(undefined);

    const result = await releaseEach(holds, release, defer, vi.fn());

    expect(defer).toHaveBeenCalledExactlyOnceWith(holds[0]);
    expect(result).toEqual({ released: 2, kept: 0, failed: 1 });
  });

  it("still finishes the batch when moving a failed hold back fails too", async () => {
    const release = vi
      .fn<(hold: DueHold) => Promise<HoldRelease>>()
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValue("released");
    const defer = vi
      .fn<(hold: DueHold) => Promise<void>>()
      .mockRejectedValue(new Error("connection lost"));

    const result = await releaseEach(holds, release, defer, vi.fn());

    expect(result).toEqual({ released: 2, kept: 0, failed: 1 });
  });
});
