"use client";

import { Button, formatMoney, PlanForm, toast, type PlanFormSubmission } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { archivePlanAction, savePlanAction } from "../../lib/payments/actions";
import { ConfirmDialog } from "../manage/confirm-dialog";

export type PlanEditorState = "none" | "draft" | "on_sale";

function samePrices(a: PlanFormSubmission, b: PlanFormSubmission): boolean {
  return (
    a.currency === b.currency &&
    a.monthlyPriceMinor === b.monthlyPriceMinor &&
    a.annualPriceMinor === b.annualPriceMinor
  );
}

function members(count: number): string {
  return count === 1 ? "1 member keeps" : `${count} members keep`;
}

export function priceChangeSummary(
  current: PlanFormSubmission,
  next: PlanFormSubmission,
  payingCount: number,
): string {
  const was = formatMoney(current.monthlyPriceMinor, current.currency);
  const now = formatMoney(next.monthlyPriceMinor, next.currency);
  return `${members(payingCount)} ${was} a month. New members pay ${now} a month.`;
}

function submitLabel(state: PlanEditorState, canSell: boolean): string {
  if (!canSell) return "Save draft";
  return state === "on_sale" ? "Save pricing" : "Put on sale";
}

export function PlanEditor({
  slug,
  currencies,
  plan,
  state,
  canSell,
  payingCount,
  platformFeeBps,
  providerName,
  disabled,
}: {
  slug: string;
  currencies: readonly string[];
  plan: PlanFormSubmission | null;
  state: PlanEditorState;
  canSell: boolean;
  payingCount: number;
  platformFeeBps: number;
  providerName: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [change, setChange] = useState<PlanFormSubmission | null>(null);
  const [pending, startTransition] = useTransition();
  const onSale = state === "on_sale";

  function saved() {
    toast.success(
      canSell ? "Pricing saved." : "Draft saved. It goes on sale when Stripe is ready.",
    );
    router.refresh();
  }

  function save(value: PlanFormSubmission) {
    setError(null);
    if (onSale && plan && payingCount > 0 && !samePrices(plan, value)) {
      setChange(value);
      return;
    }
    startTransition(async () => {
      const result = await savePlanAction({ slug, ...value });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      saved();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PlanForm
        key={
          plan
            ? `${state}-${plan.currency}-${plan.monthlyPriceMinor}-${plan.annualPriceMinor}`
            : "new"
        }
        currencies={currencies}
        initial={plan}
        currencyLocked={onSale}
        disabled={disabled}
        pending={pending}
        error={error}
        platformFeeBps={platformFeeBps}
        providerName={providerName}
        priceChangeHint={onSale}
        submitLabel={submitLabel(state, canSell)}
        onSubmit={save}
      />
      {state === "none" ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-text-muted">
            {onSale
              ? `Stop selling memberships to make the community free to join. Current paid members keep their subscriptions in ${providerName}.`
              : "Discard the draft to start over. Nothing is on sale yet."}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 self-start"
            disabled={pending}
            onClick={() => setArchiveOpen(true)}
          >
            {onSale ? "Stop selling memberships" : "Discard draft"}
          </Button>
        </div>
      )}
      {plan && change ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setChange(null);
          }}
          title="Change the price?"
          description={priceChangeSummary(plan, change, payingCount)}
          confirmLabel="Change price"
          pendingLabel="Saving…"
          onConfirm={() => savePlanAction({ slug, ...change })}
          onDone={() => {
            setChange(null);
            saved();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={onSale ? "Stop selling memberships?" : "Discard the draft?"}
        description={
          onSale
            ? `New people can join for free. Current paid members keep their subscriptions in your ${providerName} account until they cancel.`
            : "The draft price is removed. You can set a new one at any time."
        }
        confirmLabel={onSale ? "Stop selling" : "Discard draft"}
        pendingLabel={onSale ? "Stopping…" : "Discarding…"}
        onConfirm={() => archivePlanAction({ slug })}
        onDone={() => {
          toast.success(onSale ? "Memberships are no longer for sale." : "Draft discarded.");
          router.refresh();
        }}
      />
    </div>
  );
}
