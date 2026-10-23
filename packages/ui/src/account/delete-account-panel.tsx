"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "../primitives/button";
import { Input } from "../primitives/input";

export interface BlockingCommunity {
  readonly name: string;
  readonly href: string;
  readonly reason: "active" | "billing";
}

function CommunityLinks({ communities }: { readonly communities: readonly BlockingCommunity[] }) {
  return (
    <ul className="list-disc pl-5">
      {communities.map((community) => (
        <li key={community.href}>
          <a className="text-link" href={community.href}>
            {community.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface DeleteAccountPanelProps {
  readonly email: string;
  readonly graceDays: number;
  readonly blockingCommunities: readonly BlockingCommunity[];
  readonly action: (formData: FormData) => void;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly privacyHref?: string | null;
  readonly extraFields?: ReactNode;
}

export function DeleteAccountPanel({
  email,
  graceDays,
  blockingCommunities,
  action,
  pending = false,
  error,
  privacyHref = null,
  extraFields = null,
}: DeleteAccountPanelProps) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const blocked = blockingCommunities.length > 0;
  const active = blockingCommunities.filter((community) => community.reason === "active");
  const billing = blockingCommunities.filter((community) => community.reason === "billing");
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-4 rounded-md border border-danger bg-surface p-4">
      <div className="flex flex-col gap-2 text-sm text-text">
        <h3 className="text-base font-medium text-text">Delete your account?</h3>
        <p>
          You are signed out on every device right away. After {graceDays} days we delete your name,
          email, avatar, sessions, memberships, RSVPs, and course progress. Your posts and comments
          stay in their communities under the name Former member.
        </p>
        <p>
          Payment records stay with Stripe and the creators you paid, as tax law requires.
          {privacyHref ? (
            <>
              {" "}
              Read the{" "}
              <a className="text-link" href={privacyHref}>
                Privacy Policy
              </a>
              .
            </>
          ) : null}
        </p>
        <p>Changed your mind? Sign in within {graceDays} days and cancel the deletion.</p>
      </div>

      {blocked ? (
        <div role="alert" className="flex flex-col gap-2 text-sm text-text">
          {active.length > 0 ? (
            <>
              <p>
                You own {active.length === 1 ? "a community" : `${active.length} communities`}.
                Transfer ownership or archive {active.length === 1 ? "it" : "each one"} in Settings
                before you delete your account.
              </p>
              <CommunityLinks communities={active} />
            </>
          ) : null}
          {billing.length > 0 ? (
            <>
              <p>
                {billing.length === 1
                  ? "An archived community you own still bills members or has Stripe connected."
                  : `${billing.length} archived communities you own still bill members or have Stripe connected.`}{" "}
                End their subscriptions and disconnect Stripe in Payments, or delete the community,
                before you delete your account.
              </p>
              <CommunityLinks communities={billing} />
            </>
          ) : null}
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          {extraFields}
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-text">
              Type your email address to confirm
            </label>
            <Input
              id={inputId}
              name="confirmation"
              type="email"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p id={`${inputId}-error`} className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div>
            <Button type="submit" variant="danger" disabled={!matches || pending}>
              {pending ? "Deleting account…" : "Delete account"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
