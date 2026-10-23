"use client";

import { authClient } from "@cohory/auth/client";
import { forgotPasswordSchema, parseForm } from "@cohory/auth/forms";
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from "@cohory/ui";
import { useState } from "react";

import { useAuthForm } from "../../../lib/auth/use-auth-form";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | undefined>();
  const { fieldErrors, formError, formErrorRef, pending, onSubmit } = useAuthForm({
    parse: (formData) => parseForm(forgotPasswordSchema, formData),
    submit: (data) =>
      authClient.requestPasswordReset({ email: data.email, redirectTo: "/reset-password" }),
    onSuccess: (data) => setSentTo(data.email),
  });

  if (sentTo) {
    return (
      <Alert variant="success">
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          If an account uses {sentTo}, we sent it a link to reset the password. The link works for 1
          hour.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError ? (
        <Alert ref={formErrorRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <Field label="Email" error={fieldErrors["email"]}>
        {(control) => (
          <Input {...control} name="email" type="email" autoComplete="email" required />
        )}
      </Field>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>
    </form>
  );
}
