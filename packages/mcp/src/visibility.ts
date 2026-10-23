import { lapsedOperations, tokenDecision } from "@cohory/api";
import type { TokenStanding } from "@cohory/agents";
import { roleMayPerform, type ApiCredential, type CommunityRole } from "@cohory/authz";

import type { McpTool } from "./registry";

export interface ToolCaller {
  readonly credential: ApiCredential;
  readonly role: CommunityRole;
  readonly standing?: TokenStanding;
}

export function mayEverCall(tool: McpTool, caller: ToolCaller): boolean {
  const { credential, role } = caller;
  if (caller.standing === "lapsed" && !lapsedOperations.has(tool.operation.operationId)) {
    return false;
  }
  const decision = tokenDecision(credential, tool.entry, tool.operation.method);
  if (decision.kind === "refuse") return false;
  if (decision.kind === "propose") return true;
  if (
    tool.agentProposal &&
    credential.type === "agent" &&
    !credential.scopes.includes("proposals:write")
  ) {
    return false;
  }
  const action = tool.entry.meta.action;
  return action === null || roleMayPerform(role, action);
}

export function visibleTools(tools: readonly McpTool[], caller: ToolCaller): McpTool[] {
  return tools.filter((tool) => mayEverCall(tool, caller));
}
