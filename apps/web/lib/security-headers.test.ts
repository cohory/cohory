import { describe, expect, it } from "vitest";

import { securityHeaderRules, uploadsRoutePattern } from "./security-headers";

function headersFor(source: string): Record<string, string> {
  const rule = securityHeaderRules().find((candidate) => candidate.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((header) => [header.key, header.value]));
}

describe("securityHeaderRules", () => {
  it("sets nosniff, frame denial, referrer, permissions, and transport headers on every path", () => {
    expect(headersFor("/:path*")).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000",
    });
  });

  it("keeps the frame ancestors policy off the uploads route, which carries its own policy", () => {
    expect(headersFor(uploadsRoutePattern)).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    const pattern = new RegExp(`^${uploadsRoutePattern.replace("(.*)", "")}`);
    expect(pattern.test("/api/uploads/users/x/avatar.png")).toBe(false);
    expect(pattern.test("/c/slug")).toBe(true);
    expect(pattern.test("/api/v1/health")).toBe(true);
  });

  it("does not set includeSubDomains or preload, so other hosts on the domain are not forced to TLS", () => {
    expect(headersFor("/:path*")["Strict-Transport-Security"]).not.toContain("includeSubDomains");
    expect(headersFor("/:path*")["Strict-Transport-Security"]).not.toContain("preload");
  });
});
