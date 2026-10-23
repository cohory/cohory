"use client";

import { defaultScopes, type Scope, type ScopeAudience } from "@cohory/authz";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Textarea,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createAgentAction,
  regenerateAgentTokenAction,
  revokeAgentAction,
  revokeAgentTokenAction,
} from "../../lib/agents/actions";
import { disconnectAppAction } from "../../lib/oauth/actions";
import { ConfirmDialog } from "../manage/confirm-dialog";
import {
  AgentCard,
  isRepeated,
  repeatedNames,
  type AgentItem,
  type Confirmation,
} from "./agent-card";
import { expiryChoices, selectClass } from "./format";
import { ScopePicker } from "./scope-picker";
import { TokenReveal, type RevealedToken } from "./token-reveal";

export type { AgentConnectionItem, AgentItem, AgentTokenItem } from "./agent-card";

const confirmTexts = {
  agent: {
    description:
      "The agent and all its tokens stop working on the next request. Its history stays in the audit log. You cannot undo this.",
    confirmLabel: "Revoke agent",
    pendingLabel: "Revoking",
  },
  token: {
    description: "The agent stops working with this token on its next request.",
    confirmLabel: "Revoke token",
    pendingLabel: "Revoking",
  },
  regenerate: {
    description:
      "You get a new token with the same name and length of time. The old token stops working right away, so update the place that uses it.",
    confirmLabel: "Regenerate token",
    pendingLabel: "Regenerating",
  },
  disconnect: {
    description:
      "The app stops working on its next request and has to ask again to reconnect. The agent stays.",
    confirmLabel: "Disconnect",
    pendingLabel: "Disconnecting",
  },
} as const;

export function AgentsManager({
  slug,
  path,
  agents,
  available,
  audience,
  now,
  activityHref = null,
  headingAs: Heading = "h3",
}: {
  slug: string;
  path: string;
  activityHref?: string | null;
  agents: readonly AgentItem[];
  available: readonly Scope[];
  audience: ScopeAudience;
  now: string;
  headingAs?: "h3" | "h4";
}) {
  const router = useRouter();
  const at = new Date(now);
  const personal = audience === "member";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [communityWide, setCommunityWide] = useState(false);
  const [days, setDays] = useState(90);
  const [scopes, setScopes] = useState<Scope[]>(
    defaultScopes.filter((scope) => available.includes(scope)),
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedToken | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [pending, startTransition] = useTransition();
  const live = agents.filter((agent) => agent.status !== "revoked");
  const revoked = agents.filter((agent) => agent.status === "revoked");
  const repeated = repeatedNames(agents);

  function create(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createAgentAction({
        slug,
        name,
        description,
        scopes,
        communityWide,
        tokenDays: days,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setRevealed({
        token: result.data.token,
        slug: result.data.slug,
        title: `${name.trim()} is ready. Copy its token now`,
      });
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  const card = (agent: AgentItem) => (
    <AgentCard
      key={agent.id}
      slug={slug}
      agent={agent}
      duplicate={isRepeated(repeated, agent)}
      now={at}
      available={available}
      audience={audience}
      onReveal={setRevealed}
      onConfirm={setConfirming}
      activityHref={activityHref}
      headingAs={Heading === "h3" ? "h4" : "h5"}
    />
  );
  const texts = confirmTexts[confirming?.kind ?? "agent"];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="agents-heading" className="flex flex-col gap-3">
        <Heading id="agents-heading" className="text-lg text-text">
          Agents
        </Heading>
        {live.length === 0 ? (
          <p className="text-sm text-text-muted">No active agents.</p>
        ) : (
          <ul className="flex flex-col gap-3">{live.map(card)}</ul>
        )}
        {revoked.length > 0 ? (
          <details>
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Revoked agents ({revoked.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-3">{revoked.map(card)}</ul>
          </details>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle as={Heading} className="text-lg">
            Create an agent
          </CardTitle>
          {personal ? (
            <p className="text-sm text-text-muted">
              Your agent acts for you and never gets more than you have. It can read the community
              and the courses you share with it. With Propose changes, it can ask you to buy a
              membership, and nothing is charged until you finish checkout yourself. You get its
              token as soon as you create it. Connecting an AI assistant through its own sign in
              screen is only for owners and admins for now, so give your assistant this token
              instead.
            </p>
          ) : (
            <p className="text-sm text-text-muted">
              An agent acts for you, so it never gets more than your role allows. Posts it writes
              wait as drafts. With Propose changes, it can ask to move money, change roles, remove
              people, delete content, or export member data, and an owner or admin approves each
              request in Manage, Approvals. Without it, those requests are refused. You get its
              token as soon as you create it.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label="Name">
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
            <Field label="What it does" description="Optional. Up to 280 characters.">
              {(control) => (
                <Textarea
                  {...control}
                  value={description}
                  maxLength={280}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            {personal ? null : (
              <label className="flex items-start gap-3 text-sm text-text">
                <input
                  type="checkbox"
                  checked={communityWide}
                  onChange={(event) => setCommunityWide(event.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span>
                  Community wide
                  <span className="block text-text-muted">
                    Other admins can manage it too. It still acts with your permissions.
                  </span>
                </span>
              </label>
            )}
            <ScopePicker
              idPrefix="agent-scope"
              value={scopes}
              onChange={setScopes}
              available={available}
              audience={audience}
            />
            <Field label="Token expires after">
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
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={pending || revealed !== null}
              className="min-h-11 self-start"
            >
              {pending ? "Creating agent…" : "Create agent"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <TokenReveal revealed={revealed} onDone={() => setRevealed(null)} />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.kind === "agent" || confirming === null
            ? `Revoke ${confirming?.agent.name ?? "this agent"}?`
            : confirming.kind === "disconnect"
              ? `Disconnect ${confirming.connection.clientName}?`
              : `${confirming.kind === "regenerate" ? "Regenerate" : "Revoke"} ${confirming.token.name}?`
        }
        description={texts.description}
        confirmLabel={texts.confirmLabel}
        pendingLabel={texts.pendingLabel}
        danger={confirming?.kind !== "regenerate"}
        onConfirm={async () => {
          if (confirming === null || confirming.kind === "agent") {
            return revokeAgentAction({ slug, agentId: confirming?.agent.id ?? "" });
          }
          if (confirming.kind === "disconnect") {
            return disconnectAppAction({
              grantId: confirming.connection.grantId,
              communityId: confirming.connection.communityId,
              path,
            });
          }
          const ref = { slug, agentId: confirming.agent.id, tokenId: confirming.token.id };
          if (confirming.kind === "token") {
            return revokeAgentTokenAction(ref);
          }
          const result = await regenerateAgentTokenAction(ref);
          if (result.ok) {
            setRevealed({
              token: result.data.token,
              slug: result.data.slug,
              title: "Copy the new token now",
            });
          }
          return result;
        }}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
