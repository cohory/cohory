import { Button } from "@cohory/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import type { JoinIntent } from "../../lib/communities/join-intent";

import { startJoinIntentAction } from "../../app/c/[slug]/actions";
import type { JoinState } from "../../lib/communities/join-state";
import { JoinButton } from "../join-button";
import { JoinRequestDialog } from "./join-request-dialog";
import { JoinRequestForm } from "./join-request-form";
import { DirectCheckout } from "./direct-checkout";
import { OutsideMembershipPage } from "./outside-membership-page";

const fullWidth = "min-h-11 w-full md:w-auto";

function Note({ title, children }: { title: string; children: string }) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md bg-surface-hover p-3 md:max-w-72">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="text-sm text-text-muted">{children}</p>
    </div>
  );
}

function WithNote({ note, children }: { note: string | null; children: ReactNode }) {
  if (!note) {
    return children;
  }
  return (
    <div className="flex w-full flex-col gap-2 md:w-auto md:max-w-72">
      {children}
      <p data-slot="join-note" className="text-sm text-text-muted">
        {note}
      </p>
    </div>
  );
}

const yearlyLink =
  "min-h-11 rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function CheckoutChoice({
  slug,
  label,
  yearlyLabel,
}: {
  slug: string;
  label: string;
  yearlyLabel: string | null;
}) {
  const start = (intent: JoinIntent) => startJoinIntentAction.bind(null, slug, intent);
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 md:w-auto">
      <form action={start("checkout")} className="w-full md:w-auto">
        <Button type="submit" className={fullWidth}>
          {label}
        </Button>
      </form>
      {yearlyLabel ? (
        <form action={start("checkout_yearly")}>
          <button type="submit" className={yearlyLink}>
            {yearlyLabel}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function JoinPanel({
  slug,
  name,
  state,
  note = null,
  repeated = false,
}: {
  slug: string;
  name: string;
  state: JoinState;
  note?: string | null;
  repeated?: boolean;
}) {
  switch (state.kind) {
    case "member":
      return (
        <Button asChild variant="secondary" className={fullWidth}>
          <Link href={`/c/${slug}`}>Go to the community</Link>
        </Button>
      );
    case "paid":
      return (
        <OutsideMembershipPage slug={slug}>
          <WithNote note={note}>
            {state.paidJoin.asksQuestions ? (
              <Button asChild className={fullWidth}>
                <Link href={`/c/${slug}/membership`}>{state.paidJoin.label}</Link>
              </Button>
            ) : (
              <DirectCheckout
                slug={slug}
                label={state.paidJoin.label}
                yearlyLabel={state.paidJoin.yearlyLabel}
              />
            )}
          </WithNote>
        </OutsideMembershipPage>
      );
    case "rejoin":
      return (
        <JoinButton
          slug={slug}
          label="Join again"
          note="Your paid membership is still active, so joining again costs nothing extra."
        />
      );
    case "sign_up":
      return (
        <WithNote note={state.intent === "checkout" ? note : null}>
          {state.intent === "checkout" ? (
            <CheckoutChoice
              slug={slug}
              label={state.label}
              yearlyLabel={state.yearlyLabel ?? null}
            />
          ) : (
            <form
              action={startJoinIntentAction.bind(null, slug, state.intent)}
              className="w-full md:w-auto"
            >
              <Button type="submit" className={fullWidth}>
                {state.label}
              </Button>
            </form>
          )}
        </WithNote>
      );
    case "join":
      return <JoinButton slug={slug} />;
    case "request":
      return state.questions.length > 0 ? (
        <JoinRequestDialog
          slug={slug}
          name={name}
          questions={state.questions}
          openFromLink={!repeated}
        />
      ) : (
        <JoinRequestForm slug={slug} questions={[]} />
      );
    case "declined":
      return (
        <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
          <Note title="Your request was not approved.">
            {state.note ?? "You can answer the questions again and send a new request."}
          </Note>
          <JoinRequestDialog
            slug={slug}
            name={name}
            questions={state.questions}
            triggerLabel="Request again"
          />
        </div>
      );
    case "pending":
      return (
        <Note title="Request pending">
          The community team reviews new members. You&apos;ll get in as soon as they approve.
        </Note>
      );
    case "invite_only":
      return (
        <Note title="Invite only">
          New members join with an invite link. Ask a member to share one.
        </Note>
      );
    case "unavailable":
      return null;
  }
}
