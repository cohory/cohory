import type { AgentView, ApiTokenView, PersonalTokenView } from "@cohory/agents";
import type { ConnectedAppView } from "@cohory/agents/oauth";
import { availableScopes, type CommunityRole, type ScopeAudience } from "@cohory/authz";

import type {
  AgentConnectionItem,
  AgentItem,
  AgentTokenItem,
} from "../../components/agents/agent-card";
import type { PersonalTokenItem } from "../../components/agents/personal-tokens";

const agentCreators: readonly CommunityRole[] = ["owner", "admin"];

export function agentPicker(role: CommunityRole | null): {
  available: ReturnType<typeof availableScopes>;
  audience: ScopeAudience;
} {
  const staff = role !== null && agentCreators.includes(role);
  return {
    available: availableScopes(role, staff ? "agent" : "personal_agent"),
    audience: staff ? "staff" : "member",
  };
}

function tokenItem(token: ApiTokenView): AgentTokenItem {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    state: token.state,
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastUsedVia: token.lastUsedVia,
    oauth: token.oauth,
  };
}

function connectionItem(app: ConnectedAppView): AgentConnectionItem {
  return {
    grantId: app.grantId,
    communityId: app.community.id,
    clientName: app.clientName,
    redirectHost: app.redirectHost,
    connectedAt: app.createdAt.toISOString(),
    lastUsedAt: app.lastUsedAt?.toISOString() ?? null,
    canDisconnect: app.canDisconnect,
  };
}

export function agentItem(agent: AgentView, apps: readonly ConnectedAppView[] = []): AgentItem {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    scopes: agent.scopes,
    status: agent.status,
    communityWide: agent.communityWide,
    ownerName: agent.owner.name,
    createdAt: agent.createdAt.toISOString(),
    lastActivityAt: agent.lastActivityAt?.toISOString() ?? null,
    canManage: agent.canManage,
    canIssueTokens: agent.canIssueTokens,
    tokens: agent.tokens.map(tokenItem),
    connections: apps.filter((app) => app.agent.id === agent.id).map(connectionItem),
  };
}

export function personalTokenItem(token: PersonalTokenView): PersonalTokenItem {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    state: token.state,
    communityName: token.community.name,
    communitySlug: token.community.slug,
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastUsedVia: token.lastUsedVia,
  };
}
