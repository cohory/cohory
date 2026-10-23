"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Select } from "../primitives/select";
import type { Edition } from "./fee-copy";
import { formatFeeRate } from "./money";
import { ProviderCredentialsForm, type ProviderCredentials } from "./provider-credentials-form";
import { countryFromLocales, countryOptions } from "./stripe-countries";

interface OwnKeys {
  secretKey: string;
  webhookSecret: string;
}

type OwnKeysErrors = Partial<Record<keyof OwnKeys, string>>;

interface ConfirmEmailGate {
  email: string;
  pending: boolean;
  message: string | null;
  onSendLink(): void;
}

interface CreatorTermsLinks {
  terms: string;
  dpa: string;
}

const termsLinkClass = "text-link";

function CreatorTermsLine({ terms, dpa }: CreatorTermsLinks) {
  return (
    <p className="text-sm text-text-muted">
      By connecting, you agree to the{" "}
      <a href={terms} className={termsLinkClass}>
        Creator Terms
      </a>{" "}
      and the{" "}
      <a href={dpa} className={termsLinkClass}>
        Data Processing Agreement
      </a>
      . Payment processing is provided by Stripe under the{" "}
      <a href="https://stripe.com/legal/connect-account" className={termsLinkClass}>
        Stripe Connected Account Agreement
      </a>
      .
    </p>
  );
}

interface PaymentProviderSelectorProps {
  edition: Edition;
  providers?: readonly SelectableProvider[];
  platformFeeBps?: number;
  canConnect: boolean;
  pending?: boolean;
  error?: string | null;
  onConnectStripe?(country: string | null, acceptCreatorTerms: boolean): void;
  onSubmitOwnKeys?(keys: OwnKeys): void;
  onSubmitProvider?(provider: SelectableProvider, credentials: ProviderCredentials): void;
  confirmEmail?: ConfirmEmailGate | null;
  creatorTerms?: CreatorTermsLinks | null;
  className?: string;
}

function ConfirmEmailFirst({ email, pending, message, onSendLink }: ConfirmEmailGate) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-warning bg-warning-muted p-4">
      <p className="text-base font-medium text-text">Confirm your email first</p>
      <p className="text-sm text-text-muted">
        Before you connect a payment account, confirm {email}. Open the link we sent there, or send
        a new one.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 self-start"
        disabled={pending}
        onClick={onSendLink}
      >
        {pending ? "Sending link…" : "Send a new link"}
      </Button>
      <p role="status" className="text-sm text-text-muted">
        {message}
      </p>
    </div>
  );
}

function subscribeToNothing(): () => void {
  return () => {};
}

function useBrowserCountry(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => countryFromLocales(navigator.languages),
    () => null,
  );
}

function validateOwnKeys(keys: OwnKeys): OwnKeysErrors {
  const errors: OwnKeysErrors = {};
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(keys.secretKey)) {
    errors.secretKey = "Paste a secret key that starts with sk_ or rk_.";
  }
  if (!/^whsec_[A-Za-z0-9]+$/.test(keys.webhookSecret)) {
    errors.webhookSecret = "Paste the webhook signing secret that starts with whsec_.";
  }
  return errors;
}

function OwnKeysForm({ pending, onSubmit }: { pending: boolean; onSubmit?(keys: OwnKeys): void }) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [errors, setErrors] = useState<OwnKeysErrors>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keys = { secretKey: secretKey.trim(), webhookSecret: webhookSecret.trim() };
    const found = validateOwnKeys(keys);
    setErrors(found);
    if (Object.keys(found).length === 0 && !pending) {
      onSubmit?.(keys);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Secret key"
        description="Use a test key (sk_test_) until you are ready to take real payments."
        error={errors.secretKey}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secretKey}
            disabled={pending}
            onChange={(event) => setSecretKey(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Webhook signing secret"
        description="Create a webhook endpoint in Stripe first. We show its URL after you connect."
        error={errors.webhookSecret}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={webhookSecret}
            disabled={pending}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" className="min-h-11 self-start" disabled={pending}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            Checking keys
          </>
        ) : (
          "Connect Stripe"
        )}
      </Button>
    </form>
  );
}

type SelectableProvider = "stripe_connect" | "stripe_own_keys" | "polar";

interface ProviderOption {
  id: SelectableProvider;
  title: string;
  description: string;
  limits: string | null;
}

function optionFor(
  id: SelectableProvider,
  edition: Edition,
  platformFeeBps: number,
): ProviderOption {
  switch (id) {
    case "stripe_connect":
      return {
        id,
        title: "Stripe Connect",
        description:
          "Members pay you through your own Stripe account. Their subscriptions live there and Stripe sends payouts to you.",
        limits: null,
      };
    case "stripe_own_keys":
      return {
        id,
        title: "Your own Stripe account",
        description:
          "Connect the Stripe account you already have with its API keys. Members pay you directly and the keys are stored encrypted.",
        limits: null,
      };
    case "polar":
      return {
        id,
        title: "Polar",
        description:
          "Polar sells your membership as the merchant of record, handles sales tax, and pays out to you. Members manage billing in the Polar customer portal.",
        limits:
          edition === "cloud" && platformFeeBps > 0
            ? `Polar can't split fees at checkout. The ${formatFeeRate(platformFeeBps)} platform fee is recorded on each payment and billed to you monthly. Polar's own fees are separate.`
            : "No platform fee. Polar's own fees are separate.",
      };
  }
}

function defaultProviders(edition: Edition): readonly SelectableProvider[] {
  return edition === "cloud" ? ["stripe_connect"] : ["stripe_own_keys"];
}

function PaymentProviderSelector({
  edition,
  providers = defaultProviders(edition),
  platformFeeBps = 0,
  canConnect,
  pending = false,
  error,
  onConnectStripe,
  onSubmitOwnKeys,
  onSubmitProvider,
  confirmEmail = null,
  creatorTerms = null,
  className,
}: PaymentProviderSelectorProps) {
  const options = providers.map((id) => optionFor(id, edition, platformFeeBps));
  const [selected, setSelected] = useState<SelectableProvider | undefined>(options[0]?.id);
  const name = useId();
  const chosen = options.find((option) => option.id === selected) ?? options[0];
  const browserCountry = useBrowserCountry();
  const [chosenCountry, setCountry] = useState<string | null>(null);
  const country = chosenCountry ?? browserCountry ?? "";

  return (
    <div data-slot="payment-provider-selector" className={cn("flex flex-col gap-4", className)}>
      {options.length > 1 ? (
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="mb-2 text-sm font-medium text-text">How members pay you</legend>
          {options.map((option) => (
            <label
              key={option.id}
              className="flex min-h-11 cursor-pointer gap-3 rounded-md border border-border p-4 has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={chosen?.id === option.id}
                onChange={() => setSelected(option.id)}
                aria-describedby={`${name}-${option.id}`}
                className="mt-1 size-4 accent-accent"
              />
              <span className="flex flex-col gap-1">
                <span className="text-base font-medium text-text">{option.title}</span>
                <span id={`${name}-${option.id}`} className="flex flex-col gap-1">
                  <span className="text-sm text-text-muted">{option.description}</span>
                  {option.limits ? (
                    <span className="text-sm text-text-muted">{option.limits}</span>
                  ) : null}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : chosen ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="text-base font-medium text-text">{chosen.title}</p>
          <p className="text-sm text-text-muted">{chosen.description}</p>
          {chosen.limits ? <p className="text-sm text-text-muted">{chosen.limits}</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!canConnect ? (
        <p className="text-sm text-text-muted">Only the owner can connect a payment account.</p>
      ) : confirmEmail ? (
        <ConfirmEmailFirst {...confirmEmail} />
      ) : chosen?.id === "stripe_connect" ? (
        <div className="flex flex-col gap-4">
          {creatorTerms ? null : (
            <p role="alert" className="text-sm text-danger">
              This server has no Creator Terms yet, so Stripe cannot be connected. Ask the people
              who run it to publish them.
            </p>
          )}
          <Field
            label="Country of your business"
            description="Stripe sets up your account for this country. It can't be changed later."
          >
            {(control) => (
              <Select
                {...control}
                value={country}
                disabled={pending}
                onChange={(event) => setCountry(event.target.value)}
              >
                {country === "" ? (
                  <option value="" disabled>
                    Choose a country
                  </option>
                ) : null}
                {countryOptions().map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            type="button"
            className="min-h-11 self-start"
            disabled={pending || country === "" || !creatorTerms}
            aria-busy={pending || undefined}
            onClick={() => {
              if (creatorTerms) onConnectStripe?.(country, true);
            }}
          >
            {pending ? (
              <>
                <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                Opening Stripe
              </>
            ) : (
              "Connect your Stripe account"
            )}
          </Button>
          {creatorTerms ? <CreatorTermsLine {...creatorTerms} /> : null}
        </div>
      ) : chosen?.id === "stripe_own_keys" ? (
        <OwnKeysForm pending={pending} onSubmit={onSubmitOwnKeys} />
      ) : chosen ? (
        <ProviderCredentialsForm
          providerName={chosen.title}
          pending={pending}
          onSubmit={(credentials) => onSubmitProvider?.(chosen.id, credentials)}
        />
      ) : null}
    </div>
  );
}

export {
  PaymentProviderSelector,
  type ConfirmEmailGate,
  type CreatorTermsLinks,
  type OwnKeys,
  type PaymentProviderSelectorProps,
  type SelectableProvider,
};
