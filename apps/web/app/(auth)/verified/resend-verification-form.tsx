"use client";

import { authClient } from "@cohory/auth/client";
import { Button, Field, Input } from "@cohory/ui";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { authErrorMessage } from "../../../lib/auth/errors";

const emailSchema = z.email();

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "sent"; readonly email: string }
  | { readonly kind: "error"; readonly message: string };

export function ResendVerificationForm({
  email,
  callbackURL,
}: {
  email?: string;
  callbackURL: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = email ?? new FormData(event.currentTarget).get("email");
    const parsed = emailSchema.safeParse(typeof typed === "string" ? typed.trim() : typed);
    if (!parsed.success) {
      setFieldError("Enter an email address, like name@example.com.");
      return;
    }
    setFieldError(undefined);
    setPending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({ email: parsed.data, callbackURL });
      setStatus(
        error
          ? { kind: "error", message: authErrorMessage(error) }
          : { kind: "sent", email: parsed.data },
      );
    } catch {
      setStatus({ kind: "error", message: authErrorMessage({ status: 0 }) });
    }
    setPending(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      {email ? null : (
        <Field label="Email" error={fieldError}>
          {(control) => (
            <Input {...control} name="email" type="email" autoComplete="email" required />
          )}
        </Field>
      )}
      <Button type="submit" variant="secondary" className="self-start" disabled={pending}>
        {pending ? "Sending link…" : "Send a new link"}
      </Button>
      <p role="status" className="text-sm text-text-muted">
        {status.kind === "sent"
          ? `If ${status.email} still needs confirming, we sent a new link. It works for 1 hour.`
          : status.kind === "error"
            ? status.message
            : null}
      </p>
    </form>
  );
}
