"use client";

import { authClient } from "@cohory/auth/client";
import { parseForm, passwordMinLength, signUpSchema } from "@cohory/auth/forms";
import type { SignUpConsent } from "@cohory/config/legal";
import { Alert, Button, Field, Input } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useAuthForm } from "../../../lib/auth/use-auth-form";
import { isJoinContinuePath } from "../../../lib/communities/join-intent";
import { PasswordInput } from "../password-input";

const consentLinkClass = "text-link";

export function ConsentLine({ consent }: { consent: SignUpConsent }) {
  const age = `You must be ${consent.minimumAge} or older.`;
  const terms = consent.terms ? (
    <a href={consent.terms} className={consentLinkClass}>
      Terms
    </a>
  ) : null;
  const privacy = consent.privacy ? (
    <a href={consent.privacy} className={consentLinkClass}>
      Privacy Policy
    </a>
  ) : null;
  return (
    <p className="text-sm text-text-muted">
      {terms ? (
        <>
          By creating an account you agree to the {terms}
          {privacy ? <> and {privacy}</> : null}.{" "}
        </>
      ) : privacy ? (
        <>Read how we use your data in the {privacy}. </>
      ) : null}
      {terms || privacy ? age : `You must be ${consent.minimumAge} or older to create an account.`}
    </p>
  );
}

export function SignUpForm({
  redirectTo,
  consent,
}: {
  redirectTo: string;
  consent: SignUpConsent;
}) {
  const router = useRouter();
  const signedIn = useRef(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { fieldErrors, formError, formErrorRef, pending, onSubmit } = useAuthForm({
    parse: (formData) => parseForm(signUpSchema, formData),
    submit: async (data) => {
      const created = await authClient.signUp.email({ ...data, callbackURL: redirectTo });
      if (created.error) {
        return created;
      }
      const session = await authClient.signIn.email({ email: data.email, password: data.password });
      signedIn.current = !session.error;
      return { error: null };
    },
    onSuccess: (data) => {
      if (!signedIn.current) {
        setSentTo(data.email);
        return;
      }
      if (isJoinContinuePath(redirectTo)) {
        window.location.assign(redirectTo);
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    },
  });

  if (sentTo) {
    return (
      <div role="status" className="flex flex-col gap-2 text-sm">
        <p className="font-medium text-text">Check your email</p>
        <p className="text-text-muted">
          We sent a link to {sentTo} to confirm it. Open it within 1 hour to finish setting up your
          account. If you already have an account, sign in instead.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError ? (
        <Alert ref={formErrorRef} tabIndex={-1} variant="danger">
          {formError}
        </Alert>
      ) : null}
      <Field label="Name" error={fieldErrors["name"]}>
        {(control) => <Input {...control} name="name" autoComplete="name" required />}
      </Field>
      <Field label="Email" error={fieldErrors["email"]}>
        {(control) => (
          <Input {...control} name="email" type="email" autoComplete="email" required />
        )}
      </Field>
      <Field
        label="Password"
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
      <ConsentLine consent={consent} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
