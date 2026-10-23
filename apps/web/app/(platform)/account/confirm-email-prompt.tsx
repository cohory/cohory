"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@cohory/ui";
import { useActionState } from "react";

import type { VerificationState } from "../../../lib/account/verification";
import { resendVerificationAction } from "./actions";

const initialState: VerificationState = { status: "idle" };

export function ConfirmEmailPrompt({
  email,
  title = "Confirm your email",
  reason = "We only send notification emails and daily summaries to a confirmed address.",
}: {
  email: string;
  title?: string;
  reason?: string;
}) {
  const [state, action, pending] = useActionState(resendVerificationAction, initialState);

  return (
    <Alert variant="warning" role="region" aria-labelledby="confirm-email-title">
      <AlertTitle id="confirm-email-title">{title}</AlertTitle>
      <AlertDescription>
        {reason} Open the link we sent to {email}, or ask for a new one.
      </AlertDescription>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Sending link…" : "Send a new link"}
        </Button>
        <p aria-live="polite" className="text-sm text-text-muted">
          {state.status === "idle" ? null : state.message}
        </p>
      </form>
    </Alert>
  );
}

export function ApprovalAlertPrompt({ email }: { email: string }) {
  return (
    <ConfirmEmailPrompt
      email={email}
      title="Confirm your email to get approval alerts"
      reason="Agent requests expire after 72 hours, and we only email alerts about them to a confirmed address."
    />
  );
}
