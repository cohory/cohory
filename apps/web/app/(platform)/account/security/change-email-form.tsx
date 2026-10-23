"use client";

import { authClient } from "@cohory/auth/client";
import { Button, Field, Input } from "@cohory/ui";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { authErrorMessage } from "../../../../lib/auth/errors";

const emailSchema = z.email().max(254);

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const typed = new FormData(form).get("newEmail");
    const parsed = emailSchema.safeParse(typeof typed === "string" ? typed.trim() : typed);
    setStatus(null);
    if (!parsed.success) {
      setFieldError("Enter an email address, like name@example.com.");
      return;
    }
    if (parsed.data.toLowerCase() === currentEmail.toLowerCase()) {
      setFieldError("This is already your email address.");
      return;
    }
    setFieldError(undefined);
    setPending(true);
    try {
      const { error } = await authClient.changeEmail({
        newEmail: parsed.data,
        callbackURL: "/account/security",
      });
      if (error) {
        setStatus(authErrorMessage(error));
      } else {
        setStatus(
          `To approve the change, open the link we sent to ${currentEmail} within 1 hour. Then confirm ${parsed.data} from the link we send there. Until then you keep using ${currentEmail}.`,
        );
        form.reset();
      }
    } catch {
      setStatus(authErrorMessage({ status: 0 }));
    }
    setPending(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="New email address" error={fieldError}>
        {(control) => (
          <Input {...control} name="newEmail" type="email" autoComplete="email" required />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending link…" : "Change email"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {status}
        </p>
      </div>
    </form>
  );
}
