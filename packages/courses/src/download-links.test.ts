import { describe, expect, it } from "vitest";

import {
  downloadLinkTtlMs,
  signDownload,
  verifyDownload,
  type DownloadGrant,
} from "./download-links";

const secret = "unit-download-secret-that-is-long-enough";
const now = new Date("2026-10-19T10:00:00.000Z");
const grant: DownloadGrant = {
  kind: "file",
  communityId: "0190a000-0000-7000-8000-000000000001",
  courseId: "0190a000-0000-7000-8000-000000000002",
  version: "1.0.0",
  path: "references/001-checklists/checklist.md",
  userId: "0190a000-0000-7000-8000-000000000003",
  agentId: "0190a000-0000-7000-8000-000000000004",
  expiresAt: new Date(now.getTime() + downloadLinkTtlMs),
};

describe("signed agent download links", () => {
  it("round trips a grant until it expires", () => {
    const token = signDownload(secret, grant);
    expect(verifyDownload(secret, token, now)).toEqual(grant);
    expect(verifyDownload(secret, token, grant.expiresAt)).toBeNull();
  });

  it("refuses another secret, a changed body, and junk", () => {
    const token = signDownload(secret, grant);
    const [body, signature] = token.split(".");
    expect(verifyDownload(`${secret}x`, token, now)).toBeNull();
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body ?? "", "base64url").toString()),
        u: grant.agentId,
      }),
    ).toString("base64url");
    expect(verifyDownload(secret, `${forged}.${signature}`, now)).toBeNull();
    expect(verifyDownload(secret, "nope", now)).toBeNull();
    expect(verifyDownload(secret, `${token}.extra`, now)).toBeNull();
  });

  it("refuses a file grant without a path and a skill grant with one", () => {
    expect(verifyDownload(secret, signDownload(secret, { ...grant, path: null }), now)).toBeNull();
    expect(
      verifyDownload(secret, signDownload(secret, { ...grant, kind: "skill" }), now),
    ).toBeNull();
  });
});
