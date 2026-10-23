import type { ConnectedAppView } from "@cohory/agents/oauth";

import type { ConnectedAppItem } from "../../components/oauth/connected-apps";

export function connectedAppItem(app: ConnectedAppView): ConnectedAppItem {
  return {
    grantId: app.grantId,
    communityId: app.community.id,
    communityName: app.community.name,
    clientName: app.clientName,
    redirectHost: app.redirectHost,
    agentName: app.agent.name,
    ownerName: app.owner.name,
    scopes: app.scopes,
    createdAt: app.createdAt.toISOString(),
    lastUsedAt: app.lastUsedAt?.toISOString() ?? null,
    canDisconnect: app.canDisconnect,
  };
}
