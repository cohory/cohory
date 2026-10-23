import { describe, expect, it } from "vitest";

import {
  absoluteLegalUrl,
  defaultTermsVersion,
  legalLinks,
  minimumAge,
  parseLegalEnv,
  signUpConsent,
  type LegalConfig,
} from "./legal";

const unset = parseLegalEnv({});

function withUrls(urls: Partial<LegalConfig["urls"]>): LegalConfig {
  return { ...unset, urls: { ...unset.urls, ...urls } };
}

describe("parseLegalEnv", () => {
  it("leaves every optional setting empty and uses the default terms version", () => {
    expect(unset).toEqual({
      urls: { terms: null, privacy: null, imprint: null, guidelines: null },
      contactEmail: null,
      securityContact: null,
      securityPolicyUrl: null,
      sourceUrl: null,
      statusUrl: null,
      entity: null,
      governingLaw: null,
      dataRegion: null,
      termsVersion: defaultTermsVersion,
      updatedAt: null,
    });
  });

  it("reads the date the legal texts were last updated as an ISO date", () => {
    expect(parseLegalEnv({ LEGAL_UPDATED_AT: "2026-11-02" }).updatedAt).toBe("2026-11-02");
  });

  it("reads operator URLs, contacts, and the Cloud placeholders", () => {
    const config = parseLegalEnv({
      LEGAL_TERMS_URL: "https://acme.example.com/terms",
      LEGAL_PRIVACY_URL: "https://acme.example.com/privacy",
      LEGAL_IMPRINT_URL: "https://acme.example.com/imprint",
      LEGAL_GUIDELINES_URL: "https://acme.example.com/rules",
      CONTACT_EMAIL: "hello@acme.example.com",
      SECURITY_CONTACT: "security@acme.example.com",
      SECURITY_POLICY_URL: "https://acme.example.com/security",
      SOURCE_URL: "https://git.example.com/acme/cohory",
      STATUS_URL: "https://status.acme.example.com",
      LEGAL_ENTITY: "Acme Academy GmbH",
      GOVERNING_LAW: "the laws of Germany",
      DATA_REGION: "the European Union",
      TERMS_VERSION: "2026-11-01",
    });
    expect(config.urls.guidelines).toBe("https://acme.example.com/rules");
    expect(config.contactEmail).toBe("hello@acme.example.com");
    expect(config.securityPolicyUrl).toBe("https://acme.example.com/security");
    expect(config.securityContact).toBe("mailto:security@acme.example.com");
    expect(config.entity).toBe("Acme Academy GmbH");
    expect(config.termsVersion).toBe("2026-11-01");
  });

  it("keeps an HTTPS security contact as a URL", () => {
    expect(
      parseLegalEnv({ SECURITY_CONTACT: "https://acme.example.com/security" }).securityContact,
    ).toBe("https://acme.example.com/security");
  });

  it("treats blank values as unset", () => {
    expect(
      parseLegalEnv({
        LEGAL_TERMS_URL: " ",
        CONTACT_EMAIL: "",
        TERMS_VERSION: "",
        LEGAL_UPDATED_AT: "",
      }),
    ).toEqual(unset);
  });

  it.each([
    ["LEGAL_TERMS_URL", "javascript:alert(1)"],
    ["LEGAL_PRIVACY_URL", "not a url"],
    ["CONTACT_EMAIL", "nobody"],
    ["SECURITY_CONTACT", "http://acme.example.com/security"],
    ["SOURCE_URL", "ftp://example.com/src"],
    ["TERMS_VERSION", "has spaces"],
    ["TERMS_VERSION", "x".repeat(65)],
    ["LEGAL_ENTITY", "x".repeat(201)],
    ["LEGAL_UPDATED_AT", "23 October 2026"],
    ["LEGAL_UPDATED_AT", "2026-02-30"],
  ])("rejects an invalid %s and names the variable", (name, value) => {
    expect(() => parseLegalEnv({ [name]: value })).toThrow(new RegExp(name));
  });
});

describe("legalLinks", () => {
  it("links the hosted drafts on Cloud and hides links that need a contact", () => {
    expect(legalLinks(unset, "cloud")).toEqual({
      terms: "/terms",
      privacy: "/privacy",
      guidelines: "/guidelines",
      creatorTerms: "/legal/creator-terms",
      dpa: "/legal/dpa",
      imprint: null,
      contact: null,
      report: null,
      security: null,
      status: null,
      source: null,
    });
  });

  it("links the neutral templates on a self-hosted server without operator URLs", () => {
    const links = legalLinks(unset, "community");
    expect(links.terms).toBe("/terms");
    expect(links.privacy).toBe("/privacy");
    expect(links.guidelines).toBeNull();
    expect(links.creatorTerms).toBeNull();
    expect(links.dpa).toBeNull();
  });

  it("prefers operator URLs and shows contact, report, security, status, and source when set", () => {
    const config: LegalConfig = {
      ...withUrls({
        terms: "https://acme.example.com/terms",
        guidelines: "https://acme.example.com/rules",
        imprint: "https://acme.example.com/imprint",
      }),
      contactEmail: "hello@acme.example.com",
      statusUrl: "https://status.acme.example.com",
      sourceUrl: "https://git.example.com/acme/cohory",
    };
    expect(legalLinks(config, "community")).toMatchObject({
      terms: "https://acme.example.com/terms",
      privacy: "/privacy",
      guidelines: "https://acme.example.com/rules",
      imprint: "https://acme.example.com/imprint",
      contact: "/contact",
      report: "/legal/report",
      security: "/.well-known/security.txt",
      status: "https://status.acme.example.com",
      source: "https://git.example.com/acme/cohory",
    });
  });
});

describe("signUpConsent", () => {
  it("asks for agreement to the Cloud Terms and Privacy Policy and records the version", () => {
    expect(signUpConsent(unset, "cloud")).toEqual({
      terms: "/terms",
      privacy: "/privacy",
      minimumAge,
      termsVersion: defaultTermsVersion,
    });
  });

  it("states only the minimum age on a self-hosted server without operator URLs", () => {
    expect(signUpConsent(unset, "community")).toEqual({
      terms: null,
      privacy: null,
      minimumAge: 16,
      termsVersion: null,
    });
  });

  it("asks for agreement to the operator's Terms once they are set", () => {
    const consent = signUpConsent(
      { ...withUrls({ terms: "https://acme.example.com/terms" }), termsVersion: "3" },
      "community",
    );
    expect(consent).toEqual({
      terms: "https://acme.example.com/terms",
      privacy: null,
      minimumAge: 16,
      termsVersion: "3",
    });
  });
});

describe("absoluteLegalUrl", () => {
  it("joins app paths to the app URL and keeps external URLs", () => {
    expect(absoluteLegalUrl("/privacy", "https://app.example.com/base")).toBe(
      "https://app.example.com/base/privacy",
    );
    expect(absoluteLegalUrl("https://acme.example.com/p", "https://app.example.com")).toBe(
      "https://acme.example.com/p",
    );
  });
});
