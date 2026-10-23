import { agentLicenseIds, type AgentLicenseId } from "@cohory/db/schema";

export { agentLicenseIds, type AgentLicenseId };

export interface AgentLicense {
  readonly id: AgentLicenseId;
  readonly label: string;
  readonly summary: string;
}

export const defaultAgentLicenseId: AgentLicenseId = "personal_agents";

export const agentLicenses: Readonly<Record<AgentLicenseId, AgentLicense>> = {
  personal_agents: {
    id: "personal_agents",
    label: "Personal use by the buyer's agents only",
    summary:
      "Agents that act for the person who has access may read this course to help that person. They may not share the material, resell it, or use it to train models.",
  },
  team_agents: {
    id: "team_agents",
    label: "Use by agents of the buyer's own team",
    summary:
      "Agents that work for the buyer's own team may read this course for that team's work. They may not share it outside the team or use it to train models.",
  },
  custom: {
    id: "custom",
    label: "Custom terms",
    summary: "The creator wrote their own terms for agents.",
  },
};

export interface LicenseTerms {
  readonly id: AgentLicenseId;
  readonly label: string;
  readonly summary: string;
  readonly text: string | null;
}

export function licenseTerms(id: string, text: string | null): LicenseTerms {
  const license = agentLicenses[isLicenseId(id) ? id : defaultAgentLicenseId];
  return { id: license.id, label: license.label, summary: license.summary, text };
}

export function isLicenseId(value: string): value is AgentLicenseId {
  return (agentLicenseIds as readonly string[]).includes(value);
}
