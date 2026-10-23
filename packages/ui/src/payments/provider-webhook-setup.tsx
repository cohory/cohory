"use client";

import { Loader2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";

interface ProviderWebhookSetupProps {
  providerName: string;
  webhookUrl: string | null;
  webhookSecretSaved: boolean;
  lastWebhookAt: Date | null;
  canManage: boolean;
  pending: "secret" | "test" | null;
  busy: boolean;
  onSaveWebhookSecret?(secret: string): void;
  onSendTest?(): void;
  locale?: string;
  timeZone?: string;
}

function formatEventTime(date: Date, locale = "en-US", timeZone = "UTC"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

const polarEvents =
  "checkout.updated, order.paid, order.refunded, organization.updated, and every subscription event";

function ProviderWebhookSetup({
  providerName,
  webhookUrl,
  webhookSecretSaved,
  lastWebhookAt,
  canManage,
  pending,
  busy,
  onSaveWebhookSecret,
  onSendTest,
  locale,
  timeZone,
}: ProviderWebhookSetupProps) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = secret.trim();
    const problem =
      value.length < 16 || /\s/.test(value)
        ? "Paste the full signing secret, without spaces."
        : undefined;
    setError(problem);
    if (!problem && !busy) {
      onSaveWebhookSecret?.(value);
      setSecret("");
    }
  }

  return (
    <section
      aria-label="Webhook"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <p className="text-base font-medium text-text">Webhook</p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-text-muted">
        <li>
          In {providerName}, open Settings, Webhooks, and add an endpoint with this URL. Choose the
          raw format and these events: {polarEvents}.
        </li>
        <li>Copy the signing secret {providerName} shows and paste it here.</li>
      </ol>
      {webhookUrl ? (
        <p className="rounded-sm bg-surface-hover p-2 font-mono text-sm break-all text-text">
          {webhookUrl}
        </p>
      ) : null}
      {canManage ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label={webhookSecretSaved ? "Replace the signing secret" : "Webhook signing secret"}
            description="We store it encrypted and use it to check that events come from your account."
            error={error}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                disabled={busy}
                onChange={(event) => setSecret(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={webhookSecretSaved ? "secondary" : "primary"}
              className="min-h-11"
              disabled={busy}
              aria-busy={pending === "secret" || undefined}
            >
              {pending === "secret" ? (
                <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {pending === "secret" ? "Saving…" : "Save signing secret"}
            </Button>
            {webhookSecretSaved && onSendTest ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={busy}
                aria-busy={pending === "test" || undefined}
                onClick={onSendTest}
              >
                {pending === "test" ? (
                  <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {pending === "test" ? "Sending…" : "Send test event"}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      <p role="status" className="text-sm text-text-muted">
        {!webhookSecretSaved
          ? "Waiting for the signing secret."
          : lastWebhookAt
            ? `Last event received ${formatEventTime(lastWebhookAt, locale, timeZone)}.`
            : "No events received yet."}
      </p>
    </section>
  );
}

export { ProviderWebhookSetup, type ProviderWebhookSetupProps };
