"use client";

import { authClient } from "@cohory/auth/client";
import { parseForm, passwordMinLength, resetPasswordSchema } from "@cohory/auth/forms";
import { Alert, Button, Field, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";

import { useAuthForm } from "../../../lib/auth/use-auth-form";
import { PasswordInput } from "../password-input";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { fieldErrors, formError, formErrorRef, pending, onSubmit } = useAuthForm({
    parse: (formData) => parseForm(resetPasswordSchema, formData),
    submit: (data) => authClient.resetPassword({ newPassword: data.password, token }),
    onSuccess: () => {
      toast.success("Password updated. Sign in with your new password.");
      router.replace("/sign-in");
    },
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError ? (
        <Alert ref={formErrorRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <Field
        label="New password"
        description={
          fieldErrors["password"] ? undefined : `At least ${passwordMinLength} characters.`
        }
        error={fieldErrors["password"]}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="password"
            autoComplete="new-password"
            minLength={passwordMinLength}
            required
          />
        )}
      </Field>
      <Field label="Confirm new password" error={fieldErrors["confirmPassword"]}>
        {(control) => (
          <PasswordInput {...control} name="confirmPassword" autoComplete="new-password" required />
        )}
      </Field>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
