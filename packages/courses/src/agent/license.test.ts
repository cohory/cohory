import { agentLicenseIds as courseLicenseIds, licenseTerms } from "@cohory/entitlements";
import { describe, expect, it } from "vitest";

import { agentLicenseLabels } from "./format";
import { manifestLicense, manifestLicenseIds, sameLicenseId } from "./license";

describe("license mapping between course terms and the version manifest", () => {
  it("maps every course license id to a manifest id with the same label", () => {
    for (const id of courseLicenseIds) {
      const terms = licenseTerms(id, null);
      expect(agentLicenseLabels[manifestLicenseIds[id]]).toBe(terms.label);
    }
  });

  it("writes the summary and the creator's extra text for the listed terms", () => {
    const license = manifestLicense(licenseTerms("team_agents", "Only for the platform team."));
    expect(license.id).toBe("team-agent-use");
    expect(license.text).toBe(
      `${licenseTerms("team_agents", null).summary}\n\nOnly for the platform team.`,
    );
  });

  it("writes only the creator's text for custom terms", () => {
    expect(manifestLicense(licenseTerms("custom", "  Do what you like.  "))).toEqual({
      id: "custom",
      text: "Do what you like.",
    });
  });

  it("defaults to personal use by the buyer's agents", () => {
    expect(manifestLicense(licenseTerms("unknown", null)).id).toBe("personal-agent-use");
  });

  it("compares licenses by id only", () => {
    expect(sameLicenseId({ id: "custom" }, { id: "custom" })).toBe(true);
    expect(sameLicenseId({ id: "custom" }, { id: "personal-agent-use" })).toBe(false);
  });
});
