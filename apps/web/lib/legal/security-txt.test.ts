import { parseLegalEnv } from "@cohory/config/legal";
import { describe, expect, it } from "vitest";

import { securityTxt } from "./security-txt";

const now = new Date("2026-10-22T10:00:00.000Z");

describe("securityTxt", () => {
  it("is absent when the operator set no contact", () => {
    expect(securityTxt(parseLegalEnv({}), "https://app.example.com", now)).toBeNull();
  });

  it("names the security contact, an expiry 180 days out, the policy, and the canonical URL", () => {
    const legal = parseLegalEnv({
      SECURITY_CONTACT: "security@acme.example.com",
      CONTACT_EMAIL: "hello@acme.example.com",
      SECURITY_POLICY_URL: "https://acme.example.com/security",
    });
    expect(securityTxt(legal, "https://app.example.com", now)).toBe(
      [
        "Contact: mailto:security@acme.example.com",
        "Expires: 2027-04-20T10:00:00Z",
        "Policy: https://acme.example.com/security",
        "Preferred-Languages: en",
        "Canonical: https://app.example.com/.well-known/security.txt",
        "",
      ].join("\n"),
    );
  });

  it("never offers the source code address as the security policy", () => {
    const legal = parseLegalEnv({
      SECURITY_CONTACT: "security@acme.example.com",
      SOURCE_URL: "https://git.example.com/acme/cohory",
    });
    expect(securityTxt(legal, "https://app.example.com", now)).not.toContain("Policy:");
  });

  it("falls back to the general contact email", () => {
    const legal = parseLegalEnv({ CONTACT_EMAIL: "hello@acme.example.com" });
    expect(securityTxt(legal, "https://app.example.com", now)).toContain(
      "Contact: mailto:hello@acme.example.com",
    );
  });
});
