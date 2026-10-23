"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@cohory/ui";
import { useState, useTransition } from "react";

import { forceDisconnectAction, retryPaidMembersChangeAction } from "../../lib/payments/actions";
import { ConfirmDialog } from "../manage/confirm-dialog";

export interface DisconnectRun {
  readonly status: "pending" | "running" | "failed" | "done";
  readonly targetCount: number;
  readonly doneCount: number;
  readonly failedCount: number;
  readonly failedMembers: readonly { readonly userId: string; readonly name: string }[];
}

function subscriptionsWord(count: number): string {
  return count === 1 ? "1 subscription" : `${count} subscriptions`;
}

export function DisconnectProgress({
  slug,
  run,
  canManage,
  onChanged,
}: {
  slug: string;
  run: DisconnectRun | null;
  canManage: boolean;
  onChanged(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!run || run.status !== "failed") {
    return (
      <p role="status" className="text-sm text-text-muted">
        {run && run.targetCount > 0
          ? `${run.doneCount} of ${subscriptionsWord(run.targetCount)} done. Refresh the page to see the latest.`
          : "Refresh the page to see the latest."}
        {run && run.failedCount > 0
          ? ` We could not update ${subscriptionsWord(run.failedCount)} yet and keep trying.`
          : ""}
      </p>
    );
  }

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryPaidMembersChangeAction({ slug });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <Alert variant="danger">
      <AlertTitle>
        We could not remove the Cohory fee from {subscriptionsWord(run.failedCount)}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>Stripe did not accept the change for these members:</span>
        <ul className="list-disc pl-5">
          {run.failedMembers.map((member) => (
            <li key={member.userId}>{member.name}</li>
          ))}
        </ul>
        {error ? (
          <span role="alert" className="text-danger">
            {error}
          </span>
        ) : null}
        {canManage ? (
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={retry}
            >
              {pending ? "Trying again…" : "Try again"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              Disconnect anyway
            </Button>
          </span>
        ) : null}
      </AlertDescription>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect anyway?"
        description={`The connection closes now. ${subscriptionsWord(run.failedCount)} may still carry the Cohory fee. Remove it from each one in your Stripe Dashboard. We refund any platform fee we receive after you leave.`}
        confirmLabel="Disconnect anyway"
        pendingLabel="Disconnecting…"
        danger
        onConfirm={() => forceDisconnectAction({ slug })}
        onDone={onChanged}
      />
    </Alert>
  );
}
