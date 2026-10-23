import { describe, expect, it } from "vitest";

import { cloudFairUseDefaults, hasUploadLimits, limitsFor, parseFairUseEnv } from "./config";

describe("parseFairUseEnv", () => {
  it("has no limits on the Community Edition by default", () => {
    const config = parseFairUseEnv({});
    expect(config.edition).toBe("community");
    expect(config.free).toEqual({ members: null, storageBytes: null, uploadBytes: null });
    expect(config.paid).toEqual(config.free);
    expect(hasUploadLimits(config)).toBe(false);
  });

  it("uses the published Cloud limits for free and paid communities", () => {
    const config = parseFairUseEnv({ COHORY_EDITION: "cloud" });
    expect(config.free).toEqual(cloudFairUseDefaults.free);
    expect(config.free.members).toBe(1000);
    expect(config.free.storageBytes).toBe(5 * 1024 ** 3);
    expect(config.paid.members).toBeNull();
    expect(config.paid.storageBytes).toBe(50 * 1024 ** 3);
    expect(limitsFor(config, "paid")).toBe(config.paid);
    expect(limitsFor(config, "free")).toBe(config.free);
  });

  it("lets operators override each limit, including unlimited", () => {
    const config = parseFairUseEnv({
      COHORY_EDITION: "cloud",
      FAIR_USE_MEMBERS: "unlimited",
      FAIR_USE_STORAGE_BYTES: "1048576",
      FAIR_USE_PAID_UPLOAD_BYTES: " 2048 ",
      FAIR_USE_UPLOAD_BYTES: "",
    });
    expect(config.free).toEqual({
      members: null,
      storageBytes: 1048576,
      uploadBytes: cloudFairUseDefaults.free.uploadBytes,
    });
    expect(config.paid.uploadBytes).toBe(2048);
  });

  it("applies Community Edition caps to paid communities unless they have their own", () => {
    const config = parseFairUseEnv({ FAIR_USE_MEMBERS: "500", FAIR_USE_PAID_STORAGE_BYTES: "10" });
    expect(config.free).toEqual({ members: 500, storageBytes: null, uploadBytes: null });
    expect(config.paid).toEqual({ members: 500, storageBytes: 10, uploadBytes: null });
    expect(hasUploadLimits(config)).toBe(true);
  });

  it("rejects malformed values instead of silently removing a limit", () => {
    expect(() => parseFairUseEnv({ FAIR_USE_MEMBERS: "0" })).toThrow(/FAIR_USE_MEMBERS/);
    expect(() => parseFairUseEnv({ FAIR_USE_STORAGE_BYTES: "5GB" })).toThrow(
      /FAIR_USE_STORAGE_BYTES/,
    );
    expect(() => parseFairUseEnv({ COHORY_EDITION: "enterprise" })).toThrow();
  });
});
