import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const downloadLinkTtlMs = 5 * 60 * 1000;

const semver = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

const grantSchema = z.strictObject({
  v: z.literal(1),
  k: z.enum(["file", "skill"]),
  c: z.uuid(),
  r: z.uuid(),
  n: z.string().regex(semver),
  p: z.string().min(1).max(400).nullable(),
  u: z.uuid(),
  a: z.uuid().nullable(),
  e: z.int().positive(),
});

export interface DownloadGrant {
  readonly kind: "file" | "skill";
  readonly communityId: string;
  readonly courseId: string;
  readonly version: string;
  readonly path: string | null;
  readonly userId: string;
  readonly agentId: string | null;
  readonly expiresAt: Date;
}

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "cohory", "cohory.agent-downloads.v1", 32));
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function signDownload(secret: string, grant: DownloadGrant): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      k: grant.kind,
      c: grant.communityId,
      r: grant.courseId,
      n: grant.version,
      p: grant.path,
      u: grant.userId,
      a: grant.agentId,
      e: Math.floor(grant.expiresAt.getTime() / 1000),
    }),
  ).toString("base64url");
  return `${body}.${sign(keyFrom(secret), body)}`;
}

export function verifyDownload(secret: string, token: string, now: Date): DownloadGrant | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined || token.length > 2048) {
    return null;
  }
  const expected = Buffer.from(sign(keyFrom(secret), body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = grantSchema.safeParse(json);
  if (!parsed.success || parsed.data.e * 1000 <= now.getTime()) {
    return null;
  }
  const claims = parsed.data;
  if ((claims.k === "file") !== (claims.p !== null)) {
    return null;
  }
  return {
    kind: claims.k,
    communityId: claims.c,
    courseId: claims.r,
    version: claims.n,
    path: claims.p,
    userId: claims.u,
    agentId: claims.a,
    expiresAt: new Date(claims.e * 1000),
  };
}
