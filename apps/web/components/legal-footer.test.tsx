import { legalLinks, parseLegalEnv } from "@cohory/config/legal";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { footerLinks, productLine } from "./legal-footer";

describe("legal footer", () => {
  it("shows only Terms and Privacy on a self-hosted server with nothing configured", () => {
    expect(footerLinks(legalLinks(parseLegalEnv({}), "community"), null)).toEqual([
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ]);
  });

  it("shows every configured link in a fixed order", () => {
    const legal = parseLegalEnv({
      LEGAL_IMPRINT_URL: "https://acme.example.com/imprint",
      CONTACT_EMAIL: "hello@acme.example.com",
      STATUS_URL: "https://status.acme.example.com",
      SOURCE_URL: "https://git.example.com/acme/cohory",
    });
    expect(footerLinks(legalLinks(legal, "cloud")).map((link) => link.label)).toEqual([
      "Terms",
      "Privacy",
      "Community Guidelines",
      "Imprint",
      "Contact",
      "Report content",
      "Security",
      "Status",
      "Source code",
    ]);
  });

  it("links Contact to the contact form only when a contact address is set", () => {
    const withContact = footerLinks(
      legalLinks(parseLegalEnv({ CONTACT_EMAIL: "hello@acme.example.com" }), "community"),
    );
    expect(withContact).toContainEqual({ label: "Contact", href: "/contact" });
    expect(
      footerLinks(legalLinks(parseLegalEnv({}), "cloud")).map((link) => link.label),
    ).not.toContain("Contact");
  });

  it("leads with the creators community when one is configured and exists", () => {
    const links = footerLinks(legalLinks(parseLegalEnv({}), "community"), {
      label: "Cohory Creators",
      href: "/c/cohory-creators",
    });
    expect(links).toEqual([
      { label: "Cohory Creators", href: "/c/cohory-creators" },
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ]);
  });

  it("names the software and its version, with Powered by on self-hosted servers", () => {
    expect(productLine("community")).toBe(`Powered by Cohory ${packageJson.version}`);
    expect(productLine("cloud")).toBe(`Cohory ${packageJson.version}`);
  });
});
