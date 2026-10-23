import { getOAuthService } from "@cohory/agents/oauth";
import type { Metadata } from "next";

import { ConnectedApps } from "../../../../components/oauth/connected-apps";
import { actorFor } from "../../../../lib/actor";
import { connectedAppItem } from "../../../../lib/oauth/views";
import { requireAccountSession } from "../session";

export const metadata: Metadata = { title: "Connected apps" };

export default async function ConnectedAppsPage() {
  const session = await requireAccountSession("/account/connected-apps");
  const apps = await getOAuthService().listMyConnectedApps(actorFor(session));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Connected apps</h1>
        <p className="text-sm text-text-muted">
          Apps you connected to a community you run. Disconnect one to stop it right away.
        </p>
      </div>
      <ConnectedApps
        apps={apps.map(connectedAppItem)}
        path="/account/connected-apps"
        showCommunity
        showOwner={false}
        emptyText="You have not connected any apps."
      />
    </div>
  );
}
