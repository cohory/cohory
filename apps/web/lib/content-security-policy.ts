export const embedFrameSources = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.loom.com",
] as const;

export const videoThumbnailSources = [
  "https://i.ytimg.com",
  "https://i.vimeocdn.com",
  "https://cdn.loom.com",
] as const;

export interface ContentSecurityPolicyOptions {
  readonly nonce: string;
  readonly development: boolean;
}

export function contentSecurityPolicy({
  nonce,
  development,
}: ContentSecurityPolicyOptions): string {
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (development) {
    scriptSources.push("'unsafe-eval'");
  }
  const directives: [string, readonly string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSources],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...videoThumbnailSources]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "blob:"]],
    ["connect-src", ["'self'"]],
    ["frame-src", embedFrameSources],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
