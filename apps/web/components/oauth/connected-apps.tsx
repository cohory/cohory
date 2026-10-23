"use client";

import { scopeDetails, type Scope } from "@cohory/authz";
import { Button } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { disconnectAppAction } from "../../lib/oauth/actions";
import { formatDay } from "../agents/format";
import { LastUsed } from "../agents/token-meta";
import { ConfirmDialog } from "../manage/confirm-dialog";

export interface ConnectedAppItem {
  readonly grantId: string;
  readonly communityId: string;
  readonly communityName: string;
  readonly clientName: string;
  readonly redirectHost: string | null;
  readonly agentName: string;
  readonly ownerName: string;
  readonly scopes: readonly Scope[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly canDisconnect: boolean;
}

export function groupConnections(
  apps: readonly ConnectedAppItem[],
): { key: string; clientName: string; redirectHost: string | null; apps: ConnectedAppItem[] }[] {
  const groups = new Map<
    string,
    { key: string; clientName: string; redirectHost: string | null; apps: ConnectedAppItem[] }
  >();
  for (const app of apps) {
    const key = `${app.clientName}\u0000${app.redirectHost ?? ""}`;
    const group = groups.get(key) ?? {
      key,
      clientName: app.clientName,
      redirectHost: app.redirectHost,
      apps: [],
    };
    group.apps.push(app);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function ConnectedApps({
  apps,
  path,
  showCommunity,
  showOwner,
  emptyText,
}: {
  apps: readonly ConnectedAppItem[];
  path: string;
  showCommunity: boolean;
  showOwner: boolean;
  emptyText: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<ConnectedAppItem | null>(null);

  return (
    <section aria-labelledby="connected-apps-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="connected-apps-heading" className="text-lg text-text">
          Connected apps
        </h2>
        <p className="text-sm text-text-muted">
          AI assistants and tools you approved through a sign in screen. Each one works as an agent
          you own.
        </p>
      </div>
      {apps.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {groupConnections(apps).map((group) => (
            <li key={group.key} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium break-words text-text">{group.clientName}</span>
                {group.redirectHost ? (
                  <span className="font-mono text-xs break-all text-text-muted">
                    {group.redirectHost}
                  </span>
                ) : null}
                {group.apps.length > 1 ? (
                  <span className="text-sm text-text-muted">{group.apps.length} connections</span>
                ) : null}
              </div>
              <ul className="flex flex-col gap-2">
                {group.apps.map((app) => (
                  <li
                    key={app.grantId}
                    aria-label={`${app.clientName} as ${app.agentName}`}
                    className="flex flex-col gap-2 rounded-md bg-surface-raised p-3 sm:flex-row sm:items-start"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="text-sm break-words text-text">
                        Agent {app.agentName}
                        {showCommunity ? ` · ${app.communityName}` : ""}
                        {showOwner ? ` · Owner ${app.ownerName}` : ""}
                      </p>
                      <p className="text-sm break-words text-text-muted">
                        {app.scopes.map((scope) => scopeDetails[scope].label).join(", ")}
                      </p>
                      <p className="text-sm text-text-muted">
                        Connected {formatDay(app.createdAt)} ·{" "}
                        <LastUsed at={app.lastUsedAt} via={app.lastUsedAt ? "mcp" : null} />
                      </p>
                    </div>
                    {app.canDisconnect ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11 self-start"
                        onClick={() => setDisconnecting(app)}
                      >
                        Disconnect
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
        title={`Disconnect ${disconnecting?.clientName ?? "this app"}?`}
        description="It stops working on its next request and has to ask you again to reconnect. The agent stays, and you can revoke it on the Agents page."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        danger
        onConfirm={() =>
          disconnectAppAction({
            grantId: disconnecting?.grantId ?? "",
            communityId: disconnecting?.communityId,
            path,
          })
        }
        onDone={() => router.refresh()}
      />
    </section>
  );
}
