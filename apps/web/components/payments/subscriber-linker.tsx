"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  SubscriberLinkList,
  type SubscriberLinkChoice,
  type SubscriberLinkRow,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { linkSubscriptionsAction } from "../../lib/payments/link-actions";
import { plural, type LinkSummary } from "../../lib/payments/linking";
import { ConfirmDialog } from "../manage/confirm-dialog";

export interface SubscriberLinkerProps {
  slug: string;
  rows: readonly SubscriberLinkRow[];
  initialChoices: Readonly<Record<string, SubscriberLinkChoice>>;
  platformFee: { label: string } | null;
}

function ResultAlert({ summary }: { summary: LinkSummary }) {
  const done = [
    summary.linked > 0 ? `${plural(summary.linked, "subscription", "subscriptions")} linked` : null,
    summary.invited > 0
      ? `${plural(summary.invited, "person", "people")} invited (${plural(summary.emailsSent, "email", "emails")} sent)`
      : null,
    summary.skipped > 0 ? `${summary.skipped} skipped` : null,
  ].filter((part): part is string => part !== null);
  return (
    <Alert variant={summary.problems.length > 0 ? "warning" : "success"}>
      <AlertTitle>{done.length > 0 ? `${done.join(", ")}.` : "Nothing was linked."}</AlertTitle>
      <AlertDescription>
        {summary.problems.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {summary.problems.map((problem) => (
              <li key={problem.label}>
                <span className="font-medium">{problem.label}</span>: {problem.message}
              </li>
            ))}
          </ul>
        ) : (
          "Linked members have access now. Invited people get access when they sign up with that email."
        )}
      </AlertDescription>
    </Alert>
  );
}

export function SubscriberLinker({
  slug,
  rows,
  initialChoices,
  platformFee,
}: SubscriberLinkerProps) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, SubscriberLinkChoice>>({
    ...initialChoices,
  });
  const [addPlatformFee, setAddPlatformFee] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<LinkSummary | null>(null);

  const selected = rows.filter((row) => row.block === null && choices[row.id]?.action !== "skip");
  const missingInterval = selected.some((row) => !choices[row.id]?.interval);
  const linking = selected.filter((row) => choices[row.id]?.action !== "invite").length;
  const inviting = selected.length - linking;

  return (
    <div className="flex flex-col gap-4">
      {summary ? <ResultAlert summary={summary} /> : null}
      <SubscriberLinkList
        rows={rows}
        choices={choices}
        onChange={(id, choice) => setChoices((current) => ({ ...current, [id]: choice }))}
      />
      {platformFee ? (
        <label className="flex min-h-11 items-start gap-3 text-sm text-text">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-accent"
            checked={addPlatformFee}
            onChange={(event) => setAddPlatformFee(event.target.checked)}
          />
          <span>
            Add the platform fee ({platformFee.label}) to future payments of these subscriptions.
            Off by default: linked subscriptions carry no platform fee unless you choose this.
          </span>
        </label>
      ) : null}
      {missingInterval ? (
        <p className="text-sm text-text-muted">
          Choose monthly or yearly for every subscription you link or invite.
        </p>
      ) : null}
      <Button
        type="button"
        className="min-h-11 self-start"
        disabled={selected.length === 0 || missingInterval}
        onClick={() => setConfirming(true)}
      >
        Link {plural(selected.length, "subscription", "subscriptions")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Link these subscriptions?"
        description={`${plural(linking, "member gets", "members get")} access now and ${plural(inviting, "person gets", "people get")} an email to sign up. Nobody is charged, and their Stripe subscriptions keep billing as before.`}
        confirmLabel="Link subscriptions"
        pendingLabel="Linking…"
        onConfirm={async () => {
          const result = await linkSubscriptionsAction({
            slug,
            addPlatformFee,
            rows: selected.map((row) => ({
              subscriptionId: row.id,
              action: choices[row.id]?.action ?? "skip",
              interval: choices[row.id]?.interval ?? null,
            })),
          });
          if (result.ok) {
            setSummary(result.data);
          }
          return result;
        }}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
