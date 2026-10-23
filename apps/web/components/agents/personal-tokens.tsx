"use client";

import { defaultScopes, type Scope } from "@cohory/authz";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@cohory/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createPersonalTokenAction,
  regeneratePersonalTokenAction,
  revokePersonalTokenAction,
} from "../../lib/agents/actions";
import { ConfirmDialog } from "../manage/confirm-dialog";
import {
  expiresSoon,
  expiryChoices,
  expiryNote,
  formatDay,
  partitionTokens,
  selectClass,
  tokenStateLabels,
  type TokenVia,
} from "./format";
import { ScopePicker } from "./scope-picker";
import { LastUsed, ScopeChips } from "./token-meta";
import { TokenReveal, type RevealedToken } from "./token-reveal";

export interface PersonalTokenItem {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly Scope[];
  readonly state: keyof typeof tokenStateLabels;
  readonly communityName: string;
  readonly communitySlug: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly lastUsedVia: TokenVia | null;
}

export interface TokenCommunity {
  readonly id: string;
  readonly name: string;
  readonly available: readonly Scope[];
}

type Pending = { kind: "revoke" | "regenerate"; token: PersonalTokenItem };

function TokenRow({
  token,
  now,
  onAsk,
}: {
  token: PersonalTokenItem;
  now: Date;
  onAsk(pending: Pending): void;
}) {
  const soon = expiresSoon(token, now);
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words text-text">{token.name}</span>
          <Badge variant={token.state === "active" ? "success" : "neutral"}>
            {tokenStateLabels[token.state]}
          </Badge>
          {soon ? <Badge variant="warning">{expiryNote(token.expiresAt, now)}</Badge> : null}
        </div>
        <p className="text-sm break-words text-text-muted">
          {token.communityName} · <code className="font-mono">{token.prefix}…</code>
        </p>
        <ScopeChips scopes={token.scopes} />
        <p className="text-sm text-text-muted">
          {token.state === "expired" ? "Expired" : "Expires"} {formatDay(token.expiresAt)} ·{" "}
          <LastUsed at={token.lastUsedAt} via={token.lastUsedVia} />
        </p>
        <Link
          href={`/account/agents/activity?community=${encodeURIComponent(token.communitySlug)}&tokenId=${encodeURIComponent(token.id)}`}
          className="inline-flex min-h-11 items-center self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`See activity of ${token.name}`}
        >
          See activity
        </Link>
      </div>
      {token.state === "revoked" ? null : (
        <div className="flex flex-wrap gap-2 self-start">
          <Button
            type="button"
            variant={soon || token.state === "expired" ? "primary" : "secondary"}
            className="min-h-11"
            onClick={() => onAsk({ kind: "regenerate", token })}
          >
            Regenerate
          </Button>
          {token.state === "active" ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => onAsk({ kind: "revoke", token })}
            >
              Revoke
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function PersonalTokens({
  communities,
  tokens,
  now,
}: {
  communities: readonly TokenCommunity[];
  tokens: readonly PersonalTokenItem[];
  now: string;
}) {
  const router = useRouter();
  const at = new Date(now);
  const [name, setName] = useState("");
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");
  const [days, setDays] = useState(90);
  const available = communities.find((community) => community.id === communityId)?.available ?? [];
  const [scopes, setScopes] = useState<Scope[]>(
    defaultScopes.filter((scope) => available.includes(scope)),
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedToken | null>(null);
  const [asking, setAsking] = useState<Pending | null>(null);
  const [pending, startTransition] = useTransition();
  const { live, ended } = partitionTokens(tokens);

  function chooseCommunity(id: string) {
    const next = communities.find((community) => community.id === id)?.available ?? [];
    setCommunityId(id);
    setScopes((current) => current.filter((scope) => next.includes(scope)));
  }

  function create(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createPersonalTokenAction({
        communityId,
        name,
        scopes,
        expiresInDays: days,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setName("");
      setRevealed({ token: result.data.token, slug: result.data.slug });
      router.refresh();
    });
  }

  const row = (token: PersonalTokenItem) => (
    <TokenRow key={token.id} token={token} now={at} onAsk={setAsking} />
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="tokens-heading" className="flex flex-col gap-3">
        <h2 id="tokens-heading" className="text-lg text-text">
          Your tokens
        </h2>
        {live.length === 0 ? (
          <p className="text-sm text-text-muted">You have no active API tokens.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {live.map(row)}
          </ul>
        )}
        {ended.length > 0 ? (
          <details className="flex flex-col gap-2">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Revoked and expired ({ended.length})
            </summary>
            <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border">
              {ended.map(row)}
            </ul>
          </details>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create a token</CardTitle>
          <p className="text-sm text-text-muted">
            A token works in one community and acts as you, so it can never do more than your role
            allows. Choose only the permissions your tool needs.
          </p>
        </CardHeader>
        <CardContent>
          {communities.length === 0 ? (
            <p className="text-sm text-text-muted">Join a community to create a token for it.</p>
          ) : (
            <form onSubmit={create} className="flex flex-col gap-4">
              <Field label="Name" description="Something to recognize it by, like Zapier.">
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
              <Field label="Community">
                {(control) => (
                  <select
                    {...control}
                    value={communityId}
                    onChange={(event) => chooseCommunity(event.target.value)}
                    className={selectClass}
                  >
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                      </option>
                    ))}
                  </select>
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
              <ScopePicker
                key={communityId}
                idPrefix="token-scope"
                value={scopes}
                onChange={setScopes}
                available={available}
                audience="member"
              />
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
                {pending ? "Creating token…" : "Create token"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <TokenReveal revealed={revealed} onDone={() => setRevealed(null)} />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={
          asking?.kind === "regenerate"
            ? `Regenerate ${asking.token.name}?`
            : `Revoke ${asking?.token.name ?? "this token"}?`
        }
        description={
          asking?.kind === "regenerate"
            ? "You get a new token with the same name, community, permissions, and length of time. The old token stops working right away, so update the tool that uses it."
            : "Anything using it stops working on its next request. You cannot undo this."
        }
        confirmLabel={asking?.kind === "regenerate" ? "Regenerate token" : "Revoke token"}
        pendingLabel={asking?.kind === "regenerate" ? "Regenerating…" : "Revoking…"}
        danger={asking?.kind !== "regenerate"}
        onConfirm={async () => {
          if (asking?.kind !== "regenerate") {
            return revokePersonalTokenAction(asking?.token.id ?? "");
          }
          const result = await regeneratePersonalTokenAction(asking.token.id);
          if (result.ok) {
            setRevealed({
              token: result.data.token,
              slug: result.data.slug,
              title: "Copy your new token now",
            });
          }
          return result;
        }}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
