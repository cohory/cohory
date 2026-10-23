"use client";

import { authClient } from "@cohory/auth/client";
import { parseForm, signInSchema } from "@cohory/auth/forms";
import { Alert, Button, Field, Input } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";

import { authErrorMessage } from "../../../lib/auth/errors";
import { TextLink } from "../../../lib/auth/form-links";
import { useAuthForm } from "../../../lib/auth/use-auth-form";
import { isJoinContinuePath } from "../../../lib/communities/join-intent";
import { PasswordInput } from "../password-input";
import { ResendVerificationForm } from "../verified/resend-verification-form";

const emailSchema = z.email();

type LinkStatus =
  | { readonly kind: "idle" | "sending" }
  | { readonly kind: "sent"; readonly email: string }
  | { readonly kind: "error"; readonly message: string };

export function SignInForm({ redirectTo, magicLink }: { redirectTo: string; magicLink: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [link, setLink] = useState<LinkStatus>({ kind: "idle" });
  const { fieldErrors, formError, formErrorCode, formErrorRef, pending, onSubmit } = useAuthForm({
    parse: (formData) => parseForm(signInSchema, formData),
    submit: async (data) => {
      setUnconfirmed(null);
      const result = await authClient.signIn.email(data);
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        setUnconfirmed(data.email);
      }
      return result;
    },
    onSuccess: () => {
      if (isJoinContinuePath(redirectTo)) {
        window.location.assign(redirectTo);
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    },
  });

  async function sendSignInLink() {
    const typed = formRef.current?.elements.namedItem("email");
    const value = typed instanceof HTMLInputElement ? typed.value.trim() : "";
    const parsed = emailSchema.safeParse(value);
    if (!parsed.success) {
      setEmailError(
        value
          ? "Enter an email address, like name@example.com."
          : "Enter your email address first.",
      );
      if (typed instanceof HTMLInputElement) typed.focus();
      return;
    }
    setEmailError(undefined);
    setLink({ kind: "sending" });
    try {
      const { error } = await authClient.signIn.magicLink({
        email: parsed.data,
        callbackURL: redirectTo,
      });
      setLink(
        error
          ? { kind: "error", message: authErrorMessage(error) }
          : { kind: "sent", email: parsed.data },
      );
    } catch {
      setLink({ kind: "error", message: authErrorMessage({ status: 0 }) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError ? (
          <Alert ref={formErrorRef} tabIndex={-1} variant="danger">
            {formErrorCode === "INVALID_EMAIL_OR_PASSWORD" ? (
              <>
                That email and password do not match. Try again or{" "}
                <TextLink href="/forgot-password">reset your password</TextLink>.
              </>
            ) : (
              formError
            )}
          </Alert>
        ) : null}
        <Field label="Email" error={fieldErrors["email"] ?? emailError}>
          {(control) => (
            <Input {...control} name="email" type="email" autoComplete="email" required />
          )}
        </Field>
        <Field label="Password" error={fieldErrors["password"]}>
          {(control) => (
            <PasswordInput {...control} name="password" autoComplete="current-password" required />
          )}
        </Field>
        <TextLink href="/forgot-password" className="self-start text-sm">
          Forgot your password?
        </TextLink>
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        {magicLink ? (
          <Button
            type="button"
            variant="secondary"
            disabled={link.kind === "sending"}
            onClick={() => void sendSignInLink()}
          >
            {link.kind === "sending" ? "Sending link…" : "Email me a sign in link"}
          </Button>
        ) : null}
        {link.kind === "sent" || link.kind === "error" ? (
          <p role="status" className="text-sm text-text-muted">
            {link.kind === "sent"
              ? `If ${link.email} has an account, we sent a sign in link. It works for 15 minutes.`
              : link.message}
          </p>
        ) : null}
      </form>
      {unconfirmed ? <ResendVerificationForm email={unconfirmed} callbackURL={redirectTo} /> : null}
    </div>
  );
}
