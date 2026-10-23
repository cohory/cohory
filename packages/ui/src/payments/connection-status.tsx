"use client";

import { Loader2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { ProviderWebhookSetup } from "./provider-webhook-setup";

type ConnectionState = "onboarding" | "active" | "restricted" | "disconnecting" | "disconnected";

type ConnectionPending = "continue" | "refresh" | "disconnect" | "secret" | "test";

interface ConnectionStatusProps {
  provider: "stripe_connect" | "stripe_own_keys" | "polar";
  providerName?: string;
  status: ConnectionState;
  chargesEnabled: boolean;
  externalAccountId: string | null;
  livemode: boolean;
  webhookUrl?: string | null;
  webhookSecretSaved?: boolean;
  lastWebhookAt?: Date | null;
  feeBilledMonthly?: boolean;
  canManage: boolean;
  pending?: ConnectionPending | null;
  error?: string | null;
  onContinue?(): void;
  onRefresh?(): void;
  onDisconnect?(): void;
  onRequestDisconnect?(): void;
  onSaveWebhookSecret?(secret: string): void;
  onSendTest?(): void;
  children?: ReactNode;
  className?: string;
}

function isStripe(provider: ConnectionStatusProps["provider"]): boolean {
  return provider === "stripe_connect" || provider === "stripe_own_keys";
}

function titleOf(provider: ConnectionStatusProps["provider"], providerName: string): string {
  if (provider === "stripe_connect") return "Stripe Connect";
  if (provider === "stripe_own_keys") return "Your own Stripe account";
  return providerName;
}

function DisconnectConfirm({
  provider,
  name,
  feeBilledMonthly,
  busy,
  pending,
  onDisconnect,
  onRequestDisconnect,
}: {
  provider: ConnectionStatusProps["provider"];
  name: string;
  feeBilledMonthly: boolean;
  busy: boolean;
  pending: boolean;
  onDisconnect?(): void;
  onRequestDisconnect?(): void;
}) {
  const [open, setOpen] = useState(false);
  if (!open || !onDisconnect) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={busy}
        onClick={() => (onRequestDisconnect ? onRequestDisconnect() : setOpen(true))}
      >
        Disconnect {name}
      </Button>
    );
  }
  return (
    <Alert variant="warning" role="group" aria-label={`Disconnect ${name}`}>
      <AlertTitle>Disconnect {name}?</AlertTitle>
      <AlertDescription>
        Memberships stop being sold here and your pricing is archived. Existing subscriptions keep
        billing in your {name} account
        {provider === "stripe_connect"
          ? ", and the platform fee is removed from their future invoices"
          : ""}
        . Members keep access until their subscription ends.
        {feeBilledMonthly
          ? " Platform fees already recorded stay on your next monthly invoice."
          : ""}
      </AlertDescription>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          className="min-h-11"
          disabled={busy}
          aria-busy={pending || undefined}
          onClick={onDisconnect}
        >
          {pending ? <Loader2Icon aria-hidden="true" className="size-4 animate-spin" /> : null}
          {pending ? "Disconnecting…" : "Yes, disconnect"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Keep connected
        </Button>
      </div>
    </Alert>
  );
}

function ConnectionStatus({
  provider,
  providerName = "Stripe",
  status,
  chargesEnabled,
  externalAccountId,
  livemode,
  webhookUrl,
  webhookSecretSaved = false,
  lastWebhookAt = null,
  feeBilledMonthly = false,
  canManage,
  pending = null,
  error,
  onContinue,
  onRefresh,
  onDisconnect,
  onRequestDisconnect,
  onSaveWebhookSecret,
  onSendTest,
  children,
  className,
}: ConnectionStatusProps) {
  const ready = status === "active" && chargesEnabled;
  const disconnecting = status === "disconnecting";
  const busy = pending !== null;
  const canContinue =
    canManage && provider === "stripe_connect" && !ready && !disconnecting && onContinue;
  const stripe = isStripe(provider);
  const name = stripe ? "Stripe" : providerName;

  return (
    <div data-slot="connection-status" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-medium text-text">{titleOf(provider, providerName)}</p>
        {ready ? <Badge variant="success">Connected</Badge> : null}
        {disconnecting ? <Badge variant="warning">Disconnecting</Badge> : null}
        {!ready && !disconnecting ? <Badge variant="warning">Needs attention</Badge> : null}
        {livemode ? null : <Badge variant="neutral">Test mode</Badge>}
      </div>
      {disconnecting ? (
        <Alert variant="warning">
          <AlertTitle>Disconnecting {name}</AlertTitle>
          <AlertDescription>
            We are removing the Cohory fee from every subscription before the connection closes. New
            memberships are paused until then.
          </AlertDescription>
        </Alert>
      ) : ready ? (
        <p role="status" className="text-sm text-text-muted">
          {name} can take payments for this community.
        </p>
      ) : !stripe && !webhookSecretSaved ? (
        <Alert variant="warning">
          <AlertTitle>Add the webhook to finish</AlertTitle>
          <AlertDescription>
            {name} is connected. Add the webhook below so payments reach this community, then set a
            price.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <AlertTitle>{name} needs more information</AlertTitle>
          <AlertDescription>
            {status === "onboarding" && stripe
              ? "Finish setting up your Stripe account to put memberships on sale. You can save a draft price now."
              : `${name} can't take payments on this account yet. Open ${name} to see what it needs.`}
          </AlertDescription>
        </Alert>
      )}
      {ready && stripe && !livemode ? (
        <Alert variant="info">
          <AlertTitle>No real money moves in test mode</AlertTitle>
          <AlertDescription className="text-text">
            Buy a membership with card 4242 4242 4242 4242, any future expiry date, and any CVC to
            check the flow from a member&apos;s side.{" "}
            {provider === "stripe_own_keys"
              ? "To go live, connect again with your live secret key (sk_live_)."
              : "Payments go live when this server switches to live Stripe keys."}
          </AlertDescription>
        </Alert>
      ) : null}
      {children}
      {!stripe && !disconnecting ? (
        <ProviderWebhookSetup
          providerName={name}
          webhookUrl={webhookUrl ?? null}
          webhookSecretSaved={webhookSecretSaved}
          lastWebhookAt={lastWebhookAt}
          canManage={canManage}
          pending={pending === "secret" || pending === "test" ? pending : null}
          busy={busy}
          onSaveWebhookSecret={onSaveWebhookSecret}
          onSendTest={onSendTest}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canContinue ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            aria-busy={pending === "continue" || undefined}
            onClick={onContinue}
          >
            {pending === "continue" ? (
              <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {pending === "continue" ? "Opening Stripe…" : "Finish Stripe setup"}
          </Button>
        ) : null}
        {onRefresh && !disconnecting ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            aria-busy={pending === "refresh" || undefined}
            onClick={onRefresh}
          >
            {pending === "refresh" ? (
              <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {pending === "refresh" ? "Checking…" : "Check status"}
          </Button>
        ) : null}
        {canManage && !disconnecting && (onDisconnect || onRequestDisconnect) ? (
          <DisconnectConfirm
            provider={provider}
            name={name}
            feeBilledMonthly={feeBilledMonthly}
            busy={busy}
            pending={pending === "disconnect"}
            onDisconnect={onDisconnect}
            onRequestDisconnect={onRequestDisconnect}
          />
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer rounded-sm py-2 font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Details
        </summary>
        <dl className="grid gap-x-4 gap-y-2 pt-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-text-muted">{stripe ? "Stripe account" : `${name} organization`}</dt>
          <dd className="break-all text-text">{externalAccountId ?? "Not created yet"}</dd>
          <dt className="text-text-muted">Mode</dt>
          <dd className="text-text">{livemode ? "Live" : "Test"}</dd>
          {webhookUrl && stripe ? (
            <>
              <dt className="text-text-muted">Webhook URL</dt>
              <dd className="break-all text-text">{webhookUrl}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </div>
  );
}

export {
  ConnectionStatus,
  type ConnectionPending,
  type ConnectionState,
  type ConnectionStatusProps,
};
