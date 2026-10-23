"use client";

import { scopeDetails, scopes as allScopes, type Scope } from "@cohory/authz";
import { Alert, Button, CommunityMark, Field, Input } from "@cohory/ui";
import { useState, useTransition } from "react";

import { approveConnectionAction, cancelConnectionAction } from "../../lib/oauth/actions";
import { selectClass } from "../agents/format";
import { ScopePicker } from "../agents/scope-picker";

export interface ConsentCommunityItem {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly agents: readonly { id: string; name: string; scopes: readonly Scope[] }[];
  readonly available: readonly Scope[];
  readonly preferredAgentId: string | null;
}

const notableScopes: readonly Scope[] = [
  "posts:write",
  "comments:write",
  "members:read",
  "members:moderate",
  "payments:read",
  "settings:read",
];

function plain(list: readonly Scope[]): string {
  return list.map((scope) => scopeDetails[scope].label.toLowerCase()).join(", ");
}

export function consentSummary(
  chosen: readonly Scope[],
  requested: readonly Scope[] | null,
  available: readonly Scope[],
): { can: Scope[]; askedOff: Scope[]; cannot: Scope[] } {
  const can = allScopes.filter((scope) => chosen.includes(scope) && available.includes(scope));
  const askedOff = (requested ?? []).filter(
    (scope) => available.includes(scope) && !can.includes(scope),
  );
  const cannot = notableScopes.filter((scope) => !can.includes(scope) && !askedOff.includes(scope));
  return { can, askedOff, cannot };
}

export function ConsentForm({
  params,
  clientName,
  redirectHost,
  communities,
  requested,
  preselected,
}: {
  params: Readonly<Record<string, string>>;
  clientName: string;
  redirectHost: string;
  communities: readonly ConsentCommunityItem[];
  requested: readonly Scope[] | null;
  preselected: readonly Scope[];
}) {
  const first = communities[0];
  const [communityId, setCommunityId] = useState(first?.id ?? "");
  const [mode, setMode] = useState<"new" | "existing">(
    first?.preferredAgentId ? "existing" : "new",
  );
  const [name, setName] = useState(clientName.slice(0, 60));
  const [agentId, setAgentId] = useState(first?.preferredAgentId ?? "");
  const [scopes, setScopes] = useState<Scope[]>(() => {
    const preferred = first?.agents.find((item) => item.id === first.preferredAgentId);
    return preselected.filter((scope) => !preferred || preferred.scopes.includes(scope));
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const community = communities.find((item) => item.id === communityId);
  const agents = community?.agents ?? [];
  const agent = agents.find((item) => item.id === agentId);
  const roleScopes = community?.available ?? [];
  const available =
    mode === "existing" ? roleScopes.filter((scope) => agent?.scopes.includes(scope)) : roleScopes;
  const chosen = scopes.filter((scope) => available.includes(scope));
  const summary = consentSummary(chosen, requested, available);

  function chooseCommunity(id: string) {
    const next = communities.find((item) => item.id === id);
    setCommunityId(id);
    setAgentId(next?.preferredAgentId ?? "");
    setMode(next?.preferredAgentId ? "existing" : "new");
  }

  function chooseAgent(id: string) {
    setAgentId(id);
    const picked = agents.find((item) => item.id === id);
    if (picked) setScopes(scopes.filter((scope) => picked.scopes.includes(scope)));
  }

  function go(result: Awaited<ReturnType<typeof approveConnectionAction>>) {
    if (!result.ok) {
      setError(result.message);
      return;
    }
    window.location.assign(result.data.url);
  }

  function approve(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      go(
        await approveConnectionAction({
          params: { ...params },
          communityId,
          agent: mode === "new" ? { kind: "new", name } : { kind: "existing", agentId },
          scopes: chosen,
        }),
      );
    });
  }

  function cancel() {
    startTransition(async () => {
      go(await cancelConnectionAction({ ...params }));
    });
  }

  const duplicate =
    mode === "new" && agents.some((item) => item.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <form onSubmit={approve} className="flex flex-col gap-6">
      <div className="flex items-end gap-3">
        <CommunityMark
          name={community?.name ?? ""}
          logoUrl={community?.logoUrl ?? null}
          className="mb-1 size-10 shrink-0 rounded-md text-sm"
        />
        <Field
          label="Community"
          description="The app can only see and do things in this community."
          className="min-w-0 flex-1"
        >
          {(control) => (
            <select
              {...control}
              value={communityId}
              onChange={(event) => chooseCommunity(event.target.value)}
              className={selectClass}
            >
              {communities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-text">Agent</legend>
        <p className="text-sm text-text-muted">
          The app acts as an agent you own. Its work shows an Agent badge and is in the audit log.
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <input
            type="radio"
            name="agent-mode"
            value="new"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="size-4 accent-accent"
          />
          Create a new agent
        </label>
        {mode === "new" ? (
          <Field
            label="Agent name"
            description={
              duplicate
                ? "You already have an agent with this name here. To reconnect it, choose it under Use one of your agents."
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={60}
                required
                onChange={(event) => setName(event.target.value)}
                className="min-h-11"
              />
            )}
          </Field>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <input
            type="radio"
            name="agent-mode"
            value="existing"
            checked={mode === "existing"}
            disabled={agents.length === 0}
            onChange={() => setMode("existing")}
            className="size-4 accent-accent"
          />
          {agents.length === 0
            ? "Use one of your agents (you have none in this community)"
            : "Use one of your agents"}
        </label>
        {mode === "existing" ? (
          <Field
            label="Your agent"
            description={
              agentId && agentId === community?.preferredAgentId
                ? `${clientName} at ${redirectHost} used this agent last time. The app can use only permissions it already has.`
                : "The app can use only permissions this agent already has."
            }
          >
            {(control) => (
              <select
                {...control}
                value={agentId}
                required
                onChange={(event) => chooseAgent(event.target.value)}
                className={selectClass}
              >
                <option value="">Choose an agent</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </fieldset>

      <section aria-labelledby="consent-access-heading" className="flex flex-col gap-2 text-sm">
        <h2 id="consent-access-heading" className="font-medium text-text">
          What {clientName} can do
        </h2>
        {summary.can.length > 0 ? (
          <p className="text-text">It can: {plain(summary.can)}.</p>
        ) : (
          <p className="text-text">Choose at least one permission under Change permissions.</p>
        )}
        {summary.askedOff.length > 0 ? (
          <p className="text-text-muted">
            It also asked to: {plain(summary.askedOff)}. These stay off unless you turn them on.
          </p>
        ) : null}
        {summary.cannot.length > 0 ? (
          <p className="text-text-muted">It cannot: {plain(summary.cannot)}.</p>
        ) : null}
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Change permissions
          </summary>
          <div className="mt-3">
            <ScopePicker
              value={chosen}
              onChange={setScopes}
              idPrefix="consent"
              available={available}
            />
          </div>
        </details>
      </section>

      <p className="text-sm text-text-muted">
        Access renews while you use it. Disconnect any time in Account, Connected apps.
      </p>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={cancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="min-h-11 break-words"
          disabled={pending || chosen.length === 0}
        >
          Allow access to {community?.name ?? "this community"}
        </Button>
      </div>
    </form>
  );
}

export function CancelConnection({ params }: { params: Readonly<Record<string, string>> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      const result = await cancelConnectionAction({ ...params });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Button type="button" className="min-h-11 self-end" disabled={pending} onClick={cancel}>
        Go back to the app
      </Button>
    </div>
  );
}
