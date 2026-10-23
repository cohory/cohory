import { describe, expect, it, vi } from "vitest";

import {
  allowAllUploads,
  assertMemberCapacity,
  assertStorageCapacity,
  assertUploadSize,
  createUploadGuard,
} from "./check";
import { parseFairUseEnv, type FairUseLimits } from "./config";
import { LimitReachedError } from "./errors";

const limits: FairUseLimits = { members: 3, storageBytes: 100, uploadBytes: 40 };
const communityId = "019a0000-0000-7000-8000-000000000002";

describe("assertMemberCapacity", () => {
  it("allows a join while the community is under its member limit", () => {
    expect(() => assertMemberCapacity(limits, 2)).not.toThrow();
  });

  it("blocks a join once the member limit is reached", () => {
    expect(() => assertMemberCapacity(limits, 3)).toThrow(LimitReachedError);
    try {
      assertMemberCapacity(limits, 4);
    } catch (error) {
      expect(error).toMatchObject({
        code: "limit_reached",
        resource: "members",
        limit: 3,
        used: 4,
      });
    }
  });

  it("never blocks when members are unlimited", () => {
    expect(() => assertMemberCapacity({ ...limits, members: null }, 1_000_000)).not.toThrow();
  });
});

describe("upload checks", () => {
  it("blocks a single file above the upload limit", () => {
    expect(() => assertUploadSize(limits, 40)).not.toThrow();
    expect(() => assertUploadSize(limits, 41)).toThrow(
      expect.objectContaining({ resource: "upload", limit: 40 }),
    );
  });

  it("blocks an upload that would take storage over the limit", () => {
    expect(() => assertStorageCapacity(limits, 60, 40)).not.toThrow();
    expect(() => assertStorageCapacity(limits, 61, 40)).toThrow(
      expect.objectContaining({ resource: "storage", limit: 100, used: 61 }),
    );
  });
});

describe("createUploadGuard", () => {
  it("does not look up the tier or scan storage when nothing is limited", async () => {
    const tierOf = vi.fn();
    const usedBytes = vi.fn();
    const guard = createUploadGuard({ config: parseFairUseEnv({}), tierOf, usedBytes });
    expect(guard).toBe(allowAllUploads);
    await guard(communityId, 10 ** 12);
    expect(tierOf).not.toHaveBeenCalled();
    expect(usedBytes).not.toHaveBeenCalled();
  });

  it("checks the limits of the community's tier against stored bytes", async () => {
    const config = parseFairUseEnv({
      COHORY_EDITION: "cloud",
      FAIR_USE_STORAGE_BYTES: "100",
      FAIR_USE_PAID_STORAGE_BYTES: "1000",
    });
    const usedBytes = vi.fn().mockResolvedValue(90);
    const free = createUploadGuard({ config, tierOf: async () => "free", usedBytes });
    const paid = createUploadGuard({ config, tierOf: async () => "paid", usedBytes });
    await expect(free(communityId, 20)).rejects.toMatchObject({ resource: "storage" });
    await expect(paid(communityId, 20)).resolves.toBeUndefined();
    expect(usedBytes).toHaveBeenCalledWith(communityId);
  });

  it("skips the storage scan when only the file size is limited", async () => {
    const usedBytes = vi.fn();
    const guard = createUploadGuard({
      config: parseFairUseEnv({ FAIR_USE_UPLOAD_BYTES: "10" }),
      tierOf: async () => "free",
      usedBytes,
    });
    await expect(guard(communityId, 11)).rejects.toMatchObject({ resource: "upload" });
    await expect(guard(communityId, 10)).resolves.toBeUndefined();
    expect(usedBytes).not.toHaveBeenCalled();
  });
});
