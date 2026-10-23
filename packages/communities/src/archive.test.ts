import { describe, expect, it } from "vitest";

import { assertCommunityWritable, isCommunityArchived } from "./archive";
import { CommunityArchivedError } from "./errors";

describe("assertCommunityWritable", () => {
  it("allows writes to a community that is not archived", () => {
    expect(() => assertCommunityWritable({ archivedAt: null })).not.toThrow();
    expect(isCommunityArchived({ archivedAt: null })).toBe(false);
  });

  it("rejects writes to an archived community with a typed error", () => {
    const archived = { archivedAt: new Date("2026-10-01T00:00:00Z") };

    expect(() => assertCommunityWritable(archived)).toThrow(CommunityArchivedError);
    expect(isCommunityArchived(archived)).toBe(true);
  });
});
