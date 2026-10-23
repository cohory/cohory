"use client";

import { Alert, AlertDescription, Button, Field, Input } from "@cohory/ui";
import { useState, useTransition } from "react";

import type { EndpointFields } from "../../lib/webhooks/actions";
import type { ActionResult } from "../../lib/posts/errors";
import {
  webhookEventLabels,
  webhookEventNames,
  type WebhookEventName,
} from "../../lib/webhooks/views";

export interface EndpointFormProps {
  label: string;
  initial?: { url: string; description: string; eventTypes: readonly WebhookEventName[] };
  submitLabel: string;
  pendingLabel: string;
  disabled: boolean;
  onSubmit(fields: EndpointFields): Promise<ActionResult<unknown>>;
  onCancel?(): void;
}

export function EndpointForm({
  label,
  initial,
  submitLabel,
  pendingLabel,
  disabled,
  onSubmit,
  onCancel,
}: EndpointFormProps) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [events, setEvents] = useState<WebhookEventName[]>(
    initial ? [...initial.eventTypes] : ["post.created"],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(name: WebhookEventName, checked: boolean) {
    setEvents((current) =>
      checked ? [...current, name] : current.filter((existing) => existing !== name),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (events.length === 0) {
      setError("Pick at least one event to send.");
      return;
    }
    startTransition(async () => {
      const result = await onSubmit({ url, description, eventTypes: events });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={label}>
      <Field label="Endpoint URL" description="An https address that accepts POST requests.">
        {(control) => (
          <Input
            {...control}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.example.com/cohory"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Description (optional)">
        {(control) => (
          <Input
            {...control}
            maxLength={200}
            autoComplete="off"
            placeholder="Zapier, n8n, or what this is for"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">Events to send</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {webhookEventNames.map((name) => (
            <label key={name} className="flex min-h-11 items-center gap-3 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={events.includes(name)}
                onChange={(event) => toggle(name, event.target.checked)}
              />
              <span>
                {webhookEventLabels[name]}{" "}
                <span className="font-mono text-xs text-text-muted">{name}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={pending || disabled}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
