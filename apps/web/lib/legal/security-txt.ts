import type { LegalConfig } from "@cohory/config/legal";

const expiresAfterDays = 180;
const dayMs = 24 * 60 * 60 * 1000;

export function securityTxt(legal: LegalConfig, appUrl: string, now: Date): string | null {
  const contact =
    legal.securityContact ?? (legal.contactEmail ? `mailto:${legal.contactEmail}` : null);
  if (!contact) {
    return null;
  }
  const expires = new Date(now.getTime() + expiresAfterDays * dayMs);
  return [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    ...(legal.securityPolicyUrl ? [`Policy: ${legal.securityPolicyUrl}`] : []),
    "Preferred-Languages: en",
    `Canonical: ${appUrl}/.well-known/security.txt`,
    "",
  ].join("\n");
}
