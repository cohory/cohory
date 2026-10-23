"use client";

import { authClient } from "@cohory/auth/client";
import { changePasswordSchema, parseForm, passwordMinLength } from "@cohory/auth/forms";
import { Alert, Button, Field, Input } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuthForm } from "../../../../lib/auth/use-auth-form";

export function ChangePasswordForm() {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { fieldErrors, formError, pending, onSubmit } = useAuthForm({
    parse: (formData) => parseForm(changePasswordSchema, formData),
    submit: (data) => {
      setSaved(false);
      return authClient.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.password,
        revokeOtherSessions: true,
      });
    },
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });

  return (
    <form
      noValidate
      onSubmit={async (event) => {
        const form = event.currentTarget;
        await onSubmit(event);
        if (!form.querySelector("[aria-invalid=true]")) form.reset();
      }}
      className="flex flex-col gap-4"
    >
      {formError ? <Alert variant="danger">{formError}</Alert> : null}
      <Field label="Current password" error={fieldErrors["currentPassword"]}>
        {(control) => (
          <Input
            {...control}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Field
        label="New password"
        description={`At least ${passwordMinLength} characters.`}
        error={fieldErrors["password"]}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={passwordMinLength}
            required
          />
        )}
      </Field>
      <Field label="Confirm new password" error={fieldErrors["confirmPassword"]}>
        {(control) => (
          <Input
            {...control}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Changing password…" : "Change password"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {saved ? "Password changed. Other devices are signed out." : null}
        </p>
      </div>
    </form>
  );
}
