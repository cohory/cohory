import { z } from "zod";

import type { Edition } from "./edition";

type Env = Readonly<Record<string, string | undefined>>;

export const minimumAge = 16;
export const defaultTermsVersion = "1";
export const termsVersionPattern = /^[A-Za-z0-9._-]{1,64}$/;

export interface LegalConfig {
  readonly urls: {
    readonly terms: string | null;
    readonly privacy: string | null;
    readonly imprint: string | null;
    readonly guidelines: string | null;
  };
  readonly contactEmail: string | null;
  readonly securityContact: string | null;
  readonly securityPolicyUrl: string | null;
  readonly sourceUrl: string | null;
  readonly statusUrl: string | null;
  readonly entity: string | null;
  readonly governingLaw: string | null;
  readonly dataRegion: string | null;
  readonly termsVersion: string;
  readonly updatedAt: string | null;
}

export interface LegalLinks {
  readonly terms: string;
  readonly privacy: string;
  readonly guidelines: string | null;
  readonly creatorTerms: string | null;
  readonly dpa: string | null;
  readonly imprint: string | null;
  readonly contact: string | null;
  readonly report: string | null;
  readonly security: string | null;
  readonly status: string | null;
  readonly source: string | null;
}

export interface SignUpConsent {
  readonly terms: string | null;
  readonly privacy: string | null;
  readonly minimumAge: number;
  readonly termsVersion: string | null;
}

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());
const httpUrl = z.url({ protocol: /^https?$/ });
const label = z.string().trim().min(1).max(200);

const securityContact = z.union([
  z.email().transform((email) => `mailto:${email}`),
  z.url({ protocol: /^https$/ }),
]);

const legalSchema = z.object({
  LEGAL_TERMS_URL: optional(httpUrl),
  LEGAL_PRIVACY_URL: optional(httpUrl),
  LEGAL_IMPRINT_URL: optional(httpUrl),
  LEGAL_GUIDELINES_URL: optional(httpUrl),
  CONTACT_EMAIL: optional(z.email()),
  SECURITY_CONTACT: optional(securityContact),
  SECURITY_POLICY_URL: optional(z.url({ protocol: /^https$/ })),
  SOURCE_URL: optional(httpUrl),
  STATUS_URL: optional(httpUrl),
  LEGAL_ENTITY: optional(label),
  GOVERNING_LAW: optional(label),
  DATA_REGION: optional(label),
  TERMS_VERSION: optional(z.string().trim().regex(termsVersionPattern)),
  LEGAL_UPDATED_AT: optional(z.iso.date()),
});

export function parseLegalEnv(env: Env = process.env): LegalConfig {
  const result = legalSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid legal configuration: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  const parsed = result.data;
  return {
    urls: {
      terms: parsed.LEGAL_TERMS_URL ?? null,
      privacy: parsed.LEGAL_PRIVACY_URL ?? null,
      imprint: parsed.LEGAL_IMPRINT_URL ?? null,
      guidelines: parsed.LEGAL_GUIDELINES_URL ?? null,
    },
    contactEmail: parsed.CONTACT_EMAIL ?? null,
    securityContact: parsed.SECURITY_CONTACT ?? null,
    securityPolicyUrl: parsed.SECURITY_POLICY_URL ?? null,
    sourceUrl: parsed.SOURCE_URL ?? null,
    statusUrl: parsed.STATUS_URL ?? null,
    entity: parsed.LEGAL_ENTITY ?? null,
    governingLaw: parsed.GOVERNING_LAW ?? null,
    dataRegion: parsed.DATA_REGION ?? null,
    termsVersion: parsed.TERMS_VERSION ?? defaultTermsVersion,
    updatedAt: parsed.LEGAL_UPDATED_AT ?? null,
  };
}

export function legalLinks(legal: LegalConfig, edition: Edition): LegalLinks {
  const cloud = edition === "cloud";
  const securityContact = legal.securityContact ?? legal.contactEmail;
  return {
    terms: legal.urls.terms ?? "/terms",
    privacy: legal.urls.privacy ?? "/privacy",
    guidelines: legal.urls.guidelines ?? (cloud ? "/guidelines" : null),
    creatorTerms: cloud ? "/legal/creator-terms" : null,
    dpa: cloud ? "/legal/dpa" : null,
    imprint: legal.urls.imprint,
    contact: legal.contactEmail ? "/contact" : null,
    report: legal.contactEmail ? "/legal/report" : null,
    security: securityContact ? "/.well-known/security.txt" : null,
    status: legal.statusUrl,
    source: legal.sourceUrl,
  };
}

// A self-hosted server without its own Terms has nothing for people to agree to, so only the age
// rule is shown and no version is recorded.
export function signUpConsent(legal: LegalConfig, edition: Edition): SignUpConsent {
  const cloud = edition === "cloud";
  const links = legalLinks(legal, edition);
  const terms = cloud || legal.urls.terms ? links.terms : null;
  return {
    terms,
    privacy: cloud || legal.urls.privacy ? links.privacy : null,
    minimumAge,
    termsVersion: terms ? legal.termsVersion : null,
  };
}

export function absoluteLegalUrl(href: string, appUrl: string): string {
  return href.startsWith("/") ? `${appUrl.replace(/\/+$/, "")}${href}` : href;
}

let cached: LegalConfig | undefined;

export function getLegalConfig(): LegalConfig {
  cached ??= parseLegalEnv();
  return cached;
}
