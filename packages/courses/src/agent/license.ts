import type { AgentLicenseId as CourseLicenseId, LicenseTerms } from "@cohory/entitlements";

import type { AgentLicense, AgentLicenseId } from "./format";

export const manifestLicenseIds: Readonly<Record<CourseLicenseId, AgentLicenseId>> = {
  personal_agents: "personal-agent-use",
  team_agents: "team-agent-use",
  custom: "custom",
};

export function manifestLicense(terms: LicenseTerms): AgentLicense {
  const extra = terms.text?.trim() ?? "";
  const text = terms.id === "custom" ? extra : [terms.summary, extra].filter(Boolean).join("\n\n");
  return { id: manifestLicenseIds[terms.id], text };
}

export function sameLicenseId(a: Pick<AgentLicense, "id">, b: Pick<AgentLicense, "id">): boolean {
  return a.id === b.id;
}
