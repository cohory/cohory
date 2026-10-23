"use client";

import { Loader2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Select } from "../primitives/select";

interface ProviderCredentials {
  accessToken: string;
  server: "sandbox" | "production";
}

interface ProviderCredentialsFormProps {
  providerName: string;
  pending: boolean;
  onSubmit?(credentials: ProviderCredentials): void;
}

function ProviderCredentialsForm({
  providerName,
  pending,
  onSubmit,
}: ProviderCredentialsFormProps) {
  const [accessToken, setAccessToken] = useState("");
  const [server, setServer] = useState<ProviderCredentials["server"]>("sandbox");
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = accessToken.trim();
    const problem =
      token.length < 20 || /\s/.test(token)
        ? `Paste the full ${providerName} access token, without spaces.`
        : undefined;
    setError(problem);
    if (!problem && !pending) {
      onSubmit?.({ accessToken: token, server });
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Organization access token"
        description={`Create one in ${providerName} under Settings, with access to products, checkouts, orders, subscriptions, refunds, customer sessions, and organizations.`}
        error={error}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={accessToken}
            disabled={pending}
            onChange={(event) => setAccessToken(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Environment"
        description="Use the sandbox until you are ready to take real payments."
      >
        {(control) => (
          <Select
            {...control}
            value={server}
            disabled={pending}
            onChange={(event) =>
              setServer(event.target.value === "production" ? "production" : "sandbox")
            }
          >
            <option value="sandbox">Sandbox (test payments)</option>
            <option value="production">Production</option>
          </Select>
        )}
      </Field>
      <Button type="submit" className="min-h-11 self-start" disabled={pending}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            Checking token
          </>
        ) : (
          `Connect ${providerName}`
        )}
      </Button>
    </form>
  );
}

export { ProviderCredentialsForm, type ProviderCredentials, type ProviderCredentialsFormProps };
