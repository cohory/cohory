"use client";

import type { Scope, ScopeAudience } from "@cohory/authz";
import { AgentAvatar, Badge, Button, Field, Input } from "@cohory/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { issueAgentTokenAction, updateAgentAction } from "../../lib/agents/actions";
import type { ActionResult } from "../../lib/posts/errors";
import { AgentPermissionsDialog } from "./agent-permissions-dialog";
import {
  expiresSoon,
  expiryChoices,
  expiryNote,
  formatDay,
  linkButtonClass,
  partitionTokens,
  selectClass,
  tokenStateLabels,
  type TokenVia,
} from "./format";
import { LastUsed, ScopeChips } from "./token-meta";
import type { RevealedToken } from "./token-reveal";

export interface AgentTokenItem {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly state: keyof typeof tokenStateLabels;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly lastUsedVia: TokenVia | null;
  readonly oauth: boolean;
}

export interface AgentConnectionItem {
  readonly grantId: string;
  readonly communityId: string;
  readonly clientName: string;
  readonly redirectHost: string | null;
  readonly connectedAt: string;
  readonly lastUsedAt: string | null;
  readonly canDisconnect: boolean;
}

export interface AgentItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly scopes: readonly Scope[];
  readonly status: "active" | "suspended" | "revoked";
  readonly communityWide: boolean;
  readonly ownerName: string;
  readonly createdAt: string;
  readonly lastActivityAt: string | null;
  readonly canManage: boolean;
  readonly canIssueTokens: boolean;
  readonly tokens: readonly AgentTokenItem[];
  readonly connections: readonly AgentConnectionItem[];
}

export type Confirmation =
  | { kind: "agent"; agent: AgentItem }
  | { kind: "token" | "regenerate"; agent: AgentItem; token: AgentTokenItem }
  | { kind: "disconnect"; agent: AgentItem; connection: AgentConnectionItem };

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function repeatedNames(agents: readonly AgentItem[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of agents) {
    const key = nameKey(name);
    (seen.has(key) ? repeated : seen).add(key);
  }
  return repeated;
}

export function isRepeated(repeated: ReadonlySet<string>, agent: AgentItem): boolean {
  return repeated.has(nameKey(agent.name));
}

const statusLabels = { active: "Active", suspended: "Paused", revoked: "Revoked" } as const;

export function activityLink(base: string, key: "agentId" | "tokenId", id: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(id)}`;
}

function TokenLine({
  agent,
  token,
  now,
  activityHref,
  onConfirm,
}: {
  agent: AgentItem;
  token: AgentTokenItem;
  now: Date;
  activityHref: string | null;
  onConfirm(confirmation: Confirmation): void;
}) {
  const soon = expiresSoon(token, now);
  const regenerable =
    agent.canIssueTokens && agent.status === "active" && !token.oauth && token.state !== "revoked";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-raised px-3 py-2 text-sm">
      <span className="font-medium text-text">{token.name}</span>
      <code className="font-mono text-xs text-text-muted">{token.prefix}…</code>
      <span className="text-text-muted">{tokenStateLabels[token.state]}</span>
      {soon ? <Badge variant="warning">{expiryNote(token.expiresAt, now)}</Badge> : null}
      <span className="text-text-muted">
        {soon ? null : `Expires ${formatDay(token.expiresAt)} · `}
        <LastUsed at={token.lastUsedAt} via={token.lastUsedVia} />
      </span>
      {activityHref ? (
        <Link
          href={activityLink(activityHref, "tokenId", token.id)}
          className={`${linkButtonClass} inline-flex items-center`}
          aria-label={`Activity of ${token.name}`}
        >
          Activity
        </Link>
      ) : null}
      {regenerable ? (
        <button
          type="button"
          onClick={() => onConfirm({ kind: "regenerate", agent, token })}
          className={linkButtonClass}
        >
          Regenerate
        </button>
      ) : null}
      {agent.canManage && token.state === "active" ? (
        <button
          type="button"
          onClick={() => onConfirm({ kind: "token", agent, token })}
          className={`${linkButtonClass} text-danger`}
        >
          Revoke token
        </button>
      ) : null}
    </li>
  );
}

export function AgentCard({
  slug,
  agent,
  duplicate = false,
  now,
  available,
  audience,
  onReveal,
  onConfirm,
  activityHref = null,
  headingAs: Heading = "h4",
}: {
  slug: string;
  agent: AgentItem;
  activityHref?: string | null;
  duplicate?: boolean;
  now: Date;
  available: readonly Scope[];
  audience: ScopeAudience;
  onReveal(revealed: RevealedToken): void;
  onConfirm(confirmation: Confirmation): void;
  headingAs?: "h4" | "h5";
}) {
  const router = useRouter();
  const [tokenName, setTokenName] = useState("");
  const [days, setDays] = useState(90);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { live, ended } = partitionTokens(agent.tokens.filter((token) => !token.oauth));

  function run<T>(action: () => Promise<ActionResult<T>>, then?: (data: T) => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      then?.(result.data);
      router.refresh();
    });
  }

  const line = (token: AgentTokenItem) => (
    <TokenLine
      key={token.id}
      agent={agent}
      token={token}
      now={now}
      activityHref={activityHref}
      onConfirm={onConfirm}
    />
  );

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AgentAvatar />
        <Heading className="min-w-0 font-medium break-words text-text">{agent.name}</Heading>
        <Badge variant={agent.status === "active" ? "success" : "neutral"}>
          {statusLabels[agent.status]}
        </Badge>
        {agent.communityWide ? <Badge variant="neutral">Community wide</Badge> : null}
        {duplicate ? (
          <span className="text-sm text-text-muted">
            {`${agent.connections[0]?.clientName ?? "Created by hand"} · Created ${formatDay(agent.createdAt)}`}
          </span>
        ) : null}
      </div>
      {agent.description ? (
        <p className="text-sm break-words text-text-muted">{agent.description}</p>
      ) : null}
      <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="text-text-muted">Owner</dt>
        <dd className="text-text">{agent.ownerName}</dd>
        <dt className="text-text-muted">Last activity</dt>
        <dd className="flex flex-wrap items-center gap-x-3 text-text">
          {formatDay(agent.lastActivityAt)}
          {activityHref ? (
            <Link
              href={activityLink(activityHref, "agentId", agent.id)}
              className={`${linkButtonClass} inline-flex items-center`}
              aria-label={`See activity of ${agent.name}`}
            >
              See activity
            </Link>
          ) : null}
        </dd>
        <dt className="text-text-muted">Permissions</dt>
        <dd>
          <ScopeChips scopes={agent.scopes} />
        </dd>
      </dl>
      {agent.connections.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={`Apps connected to ${agent.name}`}>
          {agent.connections.map((connection) => (
            <li
              key={connection.grantId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-raised px-3 py-2 text-sm"
            >
              <span className="font-medium break-words text-text">
                Connected through {connection.clientName}
              </span>
              <span className="text-text-muted">
                Since {formatDay(connection.connectedAt)} ·{" "}
                <LastUsed at={connection.lastUsedAt} via={connection.lastUsedAt ? "mcp" : null} />
              </span>
              {connection.canDisconnect ? (
                <button
                  type="button"
                  onClick={() => onConfirm({ kind: "disconnect", agent, connection })}
                  className={`${linkButtonClass} text-danger`}
                >
                  Disconnect
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {live.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={`Tokens for ${agent.name}`}>
          {live.map(line)}
        </ul>
      ) : null}
      {ended.length > 0 ? (
        <details>
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Revoked and expired tokens ({ended.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{ended.map(line)}</ul>
        </details>
      ) : null}
      {agent.canManage && agent.status !== "revoked" ? (
        <div className="flex flex-col gap-3">
          {agent.status === "active" && agent.canIssueTokens ? (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () =>
                    issueAgentTokenAction({
                      slug,
                      agentId: agent.id,
                      name: tokenName || "Token",
                      expiresInDays: days,
                    }),
                  (data) => {
                    setTokenName("");
                    onReveal({ token: data.token, slug: data.slug });
                  },
                );
              }}
            >
              <Field label="Token name" className="sm:flex-1">
                {(control) => (
                  <Input
                    {...control}
                    value={tokenName}
                    maxLength={60}
                    placeholder={live.length === 0 ? "Laptop" : "Server"}
                    onChange={(event) => setTokenName(event.target.value)}
                    className="min-h-11"
                  />
                )}
              </Field>
              <Field label="Expires after">
                {(control) => (
                  <select
                    {...control}
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className={selectClass}
                  >
                    {expiryChoices.map((choice) => (
                      <option key={choice.days} value={choice.days}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button type="submit" variant="secondary" disabled={pending} className="min-h-11">
                Issue token
              </Button>
            </form>
          ) : null}
          {agent.canIssueTokens ? null : (
            <p className="text-sm text-text-muted">
              This agent acts for {agent.ownerName}. Only they can issue its tokens, add
              permissions, or resume it.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => setEditing(true)}
            >
              Edit permissions
            </Button>
            {agent.status === "active" || agent.canIssueTokens ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                className="min-h-11"
                onClick={() =>
                  run(() =>
                    updateAgentAction({
                      slug,
                      agentId: agent.id,
                      status: agent.status === "active" ? "suspended" : "active",
                    }),
                  )
                }
              >
                {agent.status === "active" ? "Pause agent" : "Resume agent"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 text-danger"
              onClick={() => onConfirm({ kind: "agent", agent })}
            >
              Revoke agent
            </Button>
          </div>
          <AgentPermissionsDialog
            slug={slug}
            agent={agent}
            open={editing}
            onOpenChange={setEditing}
            available={available}
            audience={audience}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
