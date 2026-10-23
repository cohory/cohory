import { getAgentsService } from "@cohory/agents";
import { can } from "@cohory/authz";

import type { OverviewViewer } from "../../../lib/manage/overview";
import { ApprovalsCard } from "../approvals-card";

export async function AgentApprovals({ viewer }: { viewer: OverviewViewer }) {
  const { actor, role, communityId, slug } = viewer;
  if (!can(actor, "read", "agent", { role })) {
    return null;
  }
  const agents = await getAgentsService().listAgents(actor, communityId);
  if (agents.length === 0) {
    return null;
  }
  return <ApprovalsCard actor={actor} communityId={communityId} slug={slug} />;
}
