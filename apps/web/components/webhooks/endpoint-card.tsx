"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@cohory/ui";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rotateWebhookSecretAction, webhookEndpointAction } from "../../lib/webhooks/actions";
import { webhookEventLabels, type EndpointRow } from "../../lib/webhooks/views";
import { ConfirmDialog } from "../manage/confirm-dialog";
import { EditEndpointDialog } from "./edit-endpoint-dialog";
import { ResendMissed } from "./resend-missed";
import { SecretReveal } from "./secret-reveal";
import { TestResult } from "./test-result";

type Confirm = "rotate" | "disable" | "delete" | null;

function when(value: string): string {
  return formatDateTimeWithZone(value, { timeZone: "UTC" });
}

function statusLine(endpoint: EndpointRow): string {
  if (endpoint.status === "disabled") {
    return endpoint.disabledReason === "failures"
      ? "Turned off after 3 days of failed deliveries."
      : "Turned off. Events are not sent.";
  }
  if (endpoint.failingSince) {
    return `Failing since ${when(endpoint.failingSince)} (${endpoint.consecutiveFailures} failed attempts).`;
  }
  return endpoint.lastSuccessAt
    ? `Last delivered ${when(endpoint.lastSuccessAt)}.`
    : "No deliveries yet.";
}

export function EndpointCard({
  slug,
  endpoint,
  selected,
  archived,
}: {
  slug: string;
  endpoint: EndpointRow;
  selected: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState(false);
  const [keepPrevious, setKeepPrevious] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [missedSince, setMissedSince] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = endpoint.status === "active";
  const base = `/c/${slug}/manage/settings/webhooks`;

  function sendTest() {
    startTransition(async () => {
      const result = await webhookEndpointAction({ slug, endpointId: endpoint.id, action: "test" });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setTestId(result.data.delivery?.id ?? null);
      if (!selected) router.push(`${base}?endpoint=${endpoint.id}`);
    });
  }

  function turnOn() {
    const since = endpoint.failingSince ?? endpoint.disabledAt;
    startTransition(async () => {
      const result = await webhookEndpointAction({
        slug,
        endpointId: endpoint.id,
        action: "enable",
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Endpoint turned on.");
      setMissedSince(since);
      router.push(`${base}?endpoint=${endpoint.id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h5" className="font-mono text-base break-all">
            {endpoint.url}
          </CardTitle>
          <Badge variant={active ? "success" : "neutral"}>{active ? "On" : "Off"}</Badge>
        </div>
        <CardDescription>
          {endpoint.description ? `${endpoint.description}. ` : ""}
          {statusLine(endpoint)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-wrap gap-2" aria-label="Events">
          {endpoint.eventTypes.map((name) => (
            <li key={name}>
              <Badge variant="neutral">{webhookEventLabels[name]}</Badge>
            </li>
          ))}
        </ul>
        {endpoint.previousSecretExpiresAt ? (
          <p className="text-sm text-text-muted">
            The old secret also works until {when(endpoint.previousSecretExpiresAt)}.
          </p>
        ) : null}
        {secret ? <SecretReveal secret={secret} onDone={() => setSecret(null)} /> : null}
        {testId ? (
          <TestResult
            key={testId}
            slug={slug}
            endpointId={endpoint.id}
            deliveryId={testId}
            onSettled={() => router.refresh()}
          />
        ) : null}
        {missedSince && active ? (
          <ResendMissed
            slug={slug}
            endpointId={endpoint.id}
            since={missedSince}
            onDone={() => {
              setMissedSince(null);
              router.refresh();
            }}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending || archived}
              onClick={sendTest}
            >
              Send test event
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending || archived}
              onClick={turnOn}
            >
              Turn on
            </Button>
          )}
          {selected ? null : (
            <Button asChild variant="ghost" className="min-h-11">
              <Link href={`${base}?endpoint=${endpoint.id}`}>View deliveries</Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={archived}
            onClick={() => setEditing(true)}
          >
            Edit endpoint
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={archived}
            onClick={() => setConfirm("rotate")}
          >
            Rotate secret
          </Button>
          {active ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setConfirm("disable")}
            >
              Turn off
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-danger"
            onClick={() => setConfirm("delete")}
          >
            Delete
          </Button>
        </div>
      </CardContent>
      {editing ? (
        <EditEndpointDialog
          slug={slug}
          endpoint={endpoint}
          disabled={archived}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => setConfirm(open ? "rotate" : null)}
        title="Rotate the signing secret?"
        description={
          keepPrevious
            ? "Deliveries are signed with both secrets for 24 hours. Update your receiver with the new one before then."
            : "The old secret stops working right away. Update your receiver with the new one."
        }
        confirmLabel="Rotate secret"
        pendingLabel="Rotating…"
        onConfirm={async () => {
          const result = await rotateWebhookSecretAction({
            slug,
            endpointId: endpoint.id,
            keepPrevious,
          });
          if (result.ok) setSecret(result.data.secret);
          return result;
        }}
        onDone={() => router.refresh()}
      >
        <label className="flex min-h-11 items-center gap-3 text-sm text-text">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={keepPrevious}
            onChange={(event) => setKeepPrevious(event.target.checked)}
          />
          Keep the old secret working for 24 hours
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "disable"}
        onOpenChange={(open) => setConfirm(open ? "disable" : null)}
        title="Turn off this endpoint?"
        description="Events stop going out. Deliveries still waiting are marked failed. You can resend them after you turn it back on."
        confirmLabel="Turn off"
        pendingLabel="Turning off…"
        danger
        onConfirm={() =>
          webhookEndpointAction({ slug, endpointId: endpoint.id, action: "disable" })
        }
        onDone={() => router.refresh()}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title="Delete this endpoint?"
        description="The endpoint and its delivery log are removed. This can't be undone."
        confirmLabel="Delete endpoint"
        pendingLabel="Deleting endpoint…"
        danger
        onConfirm={() => webhookEndpointAction({ slug, endpointId: endpoint.id, action: "delete" })}
        onDone={() => router.push(base)}
      />
    </Card>
  );
}
