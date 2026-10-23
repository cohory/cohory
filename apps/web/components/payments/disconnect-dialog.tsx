"use client";

import { Field, Input } from "@cohory/ui";
import { useState } from "react";

import { disconnectStripeAction } from "../../lib/payments/actions";
import {
  ExitReasonFields,
  exitAnswer,
  noExitReason,
  type ExitReasonValue,
} from "../feedback/exit-reason-fields";
import { ConfirmDialog } from "../manage/confirm-dialog";
import { RadioCards } from "../manage/radio-cards";

type MemberChoice = "take_members" | "wind_down";

export interface DisconnectPaidMembers {
  readonly cohory: number;
  readonly linkedImports: number;
}

function payingMembers(count: number): string {
  return count === 1 ? "1 paying member." : `${count} paying members.`;
}

function subscriptionsWord(count: number): string {
  return count === 1 ? "1 subscription" : `${count} subscriptions`;
}

const transferChoices = [
  {
    value: "take_members",
    label: "Keep them billed on the previous owner's account",
    description:
      "Subscriptions keep billing in the previous owner's Stripe account without the Cohory fee. Members are told who bills them now, and they keep access here until their current period ends.",
  },
  {
    value: "wind_down",
    label: "Wind down",
    description:
      "Every subscription ends at the end of its current period and does not renew. Members keep access here until then.",
  },
] as const;

const memberChoices = [
  {
    value: "take_members",
    label: "Take my members with me",
    description:
      "Subscriptions keep billing in your Stripe account without the Cohory fee. Members are told you bill them directly now, and they keep access here until their current period ends.",
  },
  {
    value: "wind_down",
    label: "Wind down",
    description:
      "Every subscription ends at the end of its current period and does not renew. Members keep access here until then.",
  },
] as const;

export function DisconnectDialog({
  open,
  onOpenChange,
  slug,
  providerName,
  removesFee,
  paidMembers,
  onDone,
  transfer = false,
  askWhy = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  slug: string;
  providerName: string;
  removesFee: boolean;
  paidMembers: DisconnectPaidMembers | null;
  onDone(): void;
  transfer?: boolean;
  askWhy?: boolean;
}) {
  const [choice, setChoice] = useState<MemberChoice>("take_members");
  const [leaveLinked, setLeaveLinked] = useState(false);
  const [portalLoginUrl, setPortalLoginUrl] = useState("");
  const [why, setWhy] = useState<ExitReasonValue>(noExitReason);
  const asking = askWhy && !transfer;
  const paying = (paidMembers?.cohory ?? 0) + (paidMembers?.linkedImports ?? 0);
  const linkedImports = paidMembers?.linkedImports ?? 0;
  const offerPortalLink = choice === "take_members" && !transfer;
  const fee = removesFee ? " We remove the Cohory fee from every subscription first." : "";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={transfer ? `Connect your own ${providerName} account?` : `Disconnect ${providerName}?`}
      description={
        transfer
          ? `We close the previous owner's ${providerName} connection first and archive the pricing.${fee} Existing subscriptions stay in the previous owner's account. When the connection is closed, connect your own account and set your price again.`
          : `Memberships stop being sold here and your pricing is archived.${removesFee ? " We remove the Cohory fee from every subscription first, then close the connection." : ""}`
      }
      confirmLabel={transfer ? "Close the previous account" : "Disconnect"}
      pendingLabel={transfer ? "Closing…" : "Disconnecting…"}
      danger
      onConfirm={() =>
        disconnectStripeAction({
          slug,
          memberChoice: choice,
          includeLinked: !(choice === "wind_down" && leaveLinked),
          portalLoginUrl: offerPortalLink ? portalLoginUrl : "",
          ...(asking ? { exit: exitAnswer(why) } : {}),
        })
      }
      onDone={onDone}
    >
      {paying > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-text">{payingMembers(paying)}</p>
          <RadioCards
            legend="What happens to paying members"
            name="disconnect-members"
            value={choice}
            options={transfer ? transferChoices : memberChoices}
            onChange={setChoice}
            columns={2}
          />
          {choice === "wind_down" && linkedImports > 0 ? (
            <label className="flex min-h-11 items-start gap-3 text-sm text-text">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-accent"
                checked={leaveLinked}
                onChange={(event) => setLeaveLinked(event.target.checked)}
              />
              <span>
                Leave {subscriptionsWord(linkedImports)} you linked from before Cohory running in
                your Stripe account
              </span>
            </label>
          ) : null}
          {offerPortalLink ? (
            <Field
              label="Stripe customer portal link (optional)"
              description="Members get this link in their email so they can change or cancel billing. Find it in your Stripe Dashboard under Billing, Customer portal. It starts with https://billing.stripe.com/p/login/."
            >
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://billing.stripe.com/p/login/…"
                  value={portalLoginUrl}
                  onChange={(event) => setPortalLoginUrl(event.target.value)}
                />
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
      {asking ? (
        <ExitReasonFields question="Why are you disconnecting?" value={why} onChange={setWhy} />
      ) : null}
    </ConfirmDialog>
  );
}
