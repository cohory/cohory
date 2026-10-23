import type { CommunityRole } from "@cohory/authz";

export interface ManagedAgent {
  readonly ownerId: string;
  readonly communityWide: boolean;
}

export function agentManageContext(
  role: CommunityRole | null,
  agent: ManagedAgent,
  userId: string,
): { role: CommunityRole | null; ownsResource: boolean } {
  const managesCommunity = role === "owner" || role === "admin";
  return {
    role,
    ownsResource: agent.ownerId === userId || (agent.communityWide && managesCommunity),
  };
}
