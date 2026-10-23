"use client";

import { Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../primitives/alert";
import { Button } from "../primitives/button";
import { formatBillingDate } from "./dates";
import { formatMoney, intervalNoun, type BillingInterval } from "./money";

type MembershipStatusKind = "active" | "past_due" | "canceling" | "paused" | "free" | "staff";

interface MembershipPrice {
  amountMinor: number;
  currency: string;
  interval: BillingInterval;
}

interface MembershipStatusProps {
  kind: MembershipStatusKind;
  interval?: BillingInterval | null;
  periodEnd?: Date | null;
  planName?: string | null;
  price?: MembershipPrice | null;
  canManageBilling?: boolean;
  providerName?: string;
  onManageBilling?(): void;
  onResume?(): void;
  pending?: boolean;
  children?: ReactNode;
  error?: string | null;
  locale?: string;
  timeZone?: string;
  className?: string;
}

function membershipName(planName: string): string {
  return /\bmembership$/i.test(planName.trim()) ? planName.trim() : `${planName.trim()} membership`;
}

function billingLine(props: MembershipStatusProps): string {
  const name = props.planName ? membershipName(props.planName) : null;
  if (props.price) {
    const amount = formatMoney(props.price.amountMinor, props.price.currency, props.locale);
    return `${name ?? "Membership"}. ${amount} per ${intervalNoun(props.price.interval)}.`;
  }
  const kind = props.interval === "year" ? "Yearly membership." : "Monthly membership.";
  return name ? `${name}. ${kind}` : kind;
}

function summary(props: MembershipStatusProps): { title: string; detail: string } {
  const date = props.periodEnd
    ? formatBillingDate(props.periodEnd, props.locale, props.timeZone)
    : null;
  const billing = billingLine(props);
  switch (props.kind) {
    case "active":
      return {
        title: "You're a member",
        detail: date ? `${billing} Next payment ${date}.` : billing,
      };
    case "canceling":
      return {
        title: date ? `Access until ${date}` : "Your membership is canceled",
        detail: `${billing} Your membership won't renew. You keep access until the end of the period you paid for.`,
      };
    case "paused":
      return {
        title: "Payments paused",
        detail: date
          ? `${billing} You aren't charged while payments are paused. You keep access until ${date}. Resume payments to keep your access after that.`
          : `${billing} You aren't charged while payments are paused.`,
      };
    case "past_due":
      return {
        title: "Payment failed",
        detail: `${billing} Update your payment method to keep your access. ${props.providerName ?? "Stripe"} retries the payment automatically.`,
      };
    case "free":
      return { title: "You're a member", detail: "Your membership in this community is free." };
    case "staff":
      return {
        title: "You run this community",
        detail: "Owners, admins, and moderators don't need a paid membership.",
      };
  }
}

function MembershipStatus(props: MembershipStatusProps) {
  const {
    kind,
    canManageBilling = false,
    onManageBilling,
    onResume,
    pending = false,
    error,
  } = props;
  const { title, detail } = summary(props);
  const billingButton =
    canManageBilling && onManageBilling ? (
      <Button
        type="button"
        variant={kind === "past_due" ? "primary" : "secondary"}
        className="min-h-11 self-start"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={onManageBilling}
      >
        {pending ? <Loader2Icon aria-hidden="true" className="size-4 animate-spin" /> : null}
        {pending ? "Opening billing…" : "Manage billing"}
      </Button>
    ) : null;
  const resumeButton =
    kind === "paused" && onResume ? (
      <Button
        type="button"
        className="min-h-11 self-start"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={onResume}
      >
        {pending ? <Loader2Icon aria-hidden="true" className="size-4 animate-spin" /> : null}
        Resume payments
      </Button>
    ) : null;

  return (
    <div data-slot="membership-status" className={cn("flex flex-col gap-4", props.className)}>
      {kind === "past_due" ? (
        <Alert variant="warning">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{detail}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-text">{title}</p>
          <p className="text-sm text-text-muted">{detail}</p>
        </div>
      )}
      {resumeButton || billingButton ? (
        <div className="flex flex-wrap gap-3">
          {resumeButton}
          {billingButton}
        </div>
      ) : null}
      {props.children}
      {billingButton && props.providerName && props.providerName !== "Stripe" ? (
        <p className="text-sm text-text-muted">
          Billing opens the {props.providerName} customer portal, where you can update your card or
          cancel.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export {
  MembershipStatus,
  type MembershipPrice,
  type MembershipStatusKind,
  type MembershipStatusProps,
};
