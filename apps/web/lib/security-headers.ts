export interface ResponseHeader {
  key: string;
  value: string;
}

export interface HeaderRule {
  source: string;
  headers: ResponseHeader[];
}

export const uploadsRoutePattern = "/((?!api/uploads/).*)";

export const strictTransportSecurity = "max-age=31536000";

export const baseSecurityHeaders: readonly ResponseHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: strictTransportSecurity },
];

export const frameAncestorsPolicy: ResponseHeader = {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'",
};

export function securityHeaderRules(): HeaderRule[] {
  return [
    { source: "/:path*", headers: [...baseSecurityHeaders] },
    { source: uploadsRoutePattern, headers: [frameAncestorsPolicy] },
  ];
}
