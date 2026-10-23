"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Select,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteCommunityAction,
  retryDeleteCommunityAction,
  setArchivedAction,
  transferOwnershipAction,
} from "../../lib/manage/actions";
import {
  ExitReasonFields,
  exitAnswer,
  noExitReason,
  type ExitReasonValue,
} from "../feedback/exit-reason-fields";
import { ConfirmDialog } from "./confirm-dialog";
import { RadioCards } from "./radio-cards";

interface Candidate {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
}

type Dialog = "transfer" | "archive" | "unarchive" | "stop" | "delete" | null;

type PaidMembersChoice = "stop_at_period_end" | "keep_billing";

export interface DangerZoneDeleteRun {
  readonly status: "pending" | "running" | "failed" | "done";
  readonly failedCount: number;
  readonly includeLinked: boolean;
}

export interface DangerZonePaidMembers {
  readonly connection: "open" | "disconnecting" | "closed";
  readonly deleteRun: DangerZoneDeleteRun | null;
  readonly cohory: number;
  readonly linkedImports: number;
  readonly endingAtPeriodEnd: number;
  readonly manualCancellation: number;
  readonly lastArchiveChoice: PaidMembersChoice | null;
}

function payingMembers(count: number): string {
  return count === 1 ? "1 paying member." : `${count} paying members.`;
}

function subscriptionsWord(count: number): string {
  return count === 1 ? "1 subscription" : `${count} subscriptions`;
}

function deleteSummary(archived: boolean, run: DangerZoneDeleteRun | null): string {
  if (!archived) {
    return "Archive the community first. Then you can delete it.";
  }
  if (run?.status === "pending" || run?.status === "running") {
    return "We are cancelling paying members' subscriptions. The community is deleted when that is done.";
  }
  if (run?.status === "done") {
    return "Every subscription is cancelled. Delete the community to finish.";
  }
  return "Deletes the community and everything in it for good. Download your members CSV first.";
}

const archiveChoices = [
  {
    value: "stop_at_period_end",
    label: "Stop at period end",
    description:
      "Every subscription ends at the end of its current period and does not renew. Members can read the community until then.",
  },
  {
    value: "keep_billing",
    label: "Keep billing",
    description:
      "Subscriptions continue. Members can still read the community and can cancel from their membership page.",
  },
] as const;

export function DangerZone({
  slug,
  name,
  archived,
  candidates,
  paidMembers = null,
  askWhy = false,
}: {
  slug: string;
  name: string;
  archived: boolean;
  candidates: Candidate[];
  paidMembers?: DangerZonePaidMembers | null;
  askWhy?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [choice, setChoice] = useState<PaidMembersChoice>("stop_at_period_end");
  const [leaveLinked, setLeaveLinked] = useState(false);
  const [deleteLeavesLinked, setDeleteLeavesLinked] = useState(false);
  const [cancelledInStripe, setCancelledInStripe] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [archiveWhy, setArchiveWhy] = useState<ExitReasonValue>(noExitReason);
  const [deleteWhy, setDeleteWhy] = useState<ExitReasonValue>(noExitReason);
  const [retrying, startRetry] = useTransition();
  const paying = (paidMembers?.cohory ?? 0) + (paidMembers?.linkedImports ?? 0);
  const linkedImports = paidMembers?.linkedImports ?? 0;
  const ending = paidMembers?.endingAtPeriodEnd ?? 0;
  const deleteRun = paidMembers?.deleteRun ?? null;
  const deleting = deleteRun?.status === "pending" || deleteRun?.status === "running";
  const deleteFailed = deleteRun?.status === "failed";
  const manualCancellation = paidMembers?.manualCancellation ?? 0;
  const needsManualCancellation = manualCancellation > 0;
  const paymentsConnected =
    paidMembers?.connection === "open" || paidMembers?.connection === "disconnecting";
  const cancelledNow = deleteLeavesLinked ? paying - linkedImports : paying;
  const canStopRenewals =
    archived && paying > 0 && paidMembers?.lastArchiveChoice === "keep_billing";
  const [newOwner, setNewOwner] = useState("");
  const newOwnerName = candidates.find((c) => c.userId === newOwner)?.name ?? "";
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const retryDelete = () => {
    setRetryError(null);
    startRetry(async () => {
      const result = await retryDeleteCommunityAction({
        slug,
        includeLinked: deleteRun?.includeLinked ?? true,
      });
      if (!result.ok) {
        setRetryError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card className="border-danger">
      <CardHeader>
        <CardTitle className="text-lg">Danger zone</CardTitle>
        <CardDescription>These changes affect everyone in the community.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-3 pb-4">
          <h4 className="text-base font-medium text-text">Transfer ownership</h4>
          <p className="text-sm text-text-muted">
            The new owner gets full control, including payments and deleting the community. You
            become an admin.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="New owner" className="min-w-56">
              {(control) => (
                <Select
                  {...control}
                  value={newOwner}
                  onChange={(event) => setNewOwner(event.target.value)}
                >
                  <option value="">Choose a member</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.userId} value={candidate.userId}>
                      {candidate.username
                        ? `${candidate.name} (@${candidate.username})`
                        : candidate.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={newOwner === ""}
              onClick={() => setDialog("transfer")}
            >
              Transfer ownership
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 py-4">
          <h4 className="text-base font-medium text-text">
            {archived ? "Restore community" : "Archive community"}
          </h4>
          <p className="text-sm text-text-muted">
            {archived
              ? "Members can post, comment, and RSVP again. People can join and invite links work."
              : "The community becomes read only. Members can still read everything, but no one can join, post, comment, react, RSVP, or record progress until you restore it."}
          </p>
          {archived && paying > 0 ? (
            <p className="text-sm text-text-muted">
              {canStopRenewals
                ? `${payingMembers(paying)} Their subscriptions keep billing.`
                : ending > 0
                  ? `${payingMembers(paying)} ${subscriptionsWord(ending)} ${ending === 1 ? "is" : "are"} set to end at the period end.`
                  : payingMembers(paying)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 self-start"
              onClick={() => setDialog(archived ? "unarchive" : "archive")}
            >
              {archived ? "Restore community" : "Archive community"}
            </Button>
            {canStopRenewals ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 self-start"
                onClick={() => setDialog("stop")}
              >
                Stop renewals at period end
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-4">
          <h4 className="text-base font-medium text-text">Delete community</h4>
          <p className="text-sm text-text-muted">{deleteSummary(archived, deleteRun)}</p>
          {archived && deleteFailed ? (
            <div role="alert" className="flex flex-col gap-3">
              <p className="text-sm text-danger">
                We could not cancel {subscriptionsWord(deleteRun.failedCount)}. Try again or cancel
                them in your Stripe Dashboard.
              </p>
              {retryError ? <p className="text-sm text-danger">{retryError}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {archived && deleteFailed ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 self-start"
                disabled={retrying}
                onClick={retryDelete}
              >
                {retrying ? "Trying again…" : "Try again"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              className="min-h-11 self-start"
              disabled={!archived || deleting}
              onClick={() => setDialog("delete")}
            >
              {deleting ? "Deleting…" : "Delete community"}
            </Button>
          </div>
        </div>
      </CardContent>
      <ConfirmDialog
        open={dialog === "transfer"}
        onOpenChange={close}
        title={`Make ${newOwnerName} the owner?`}
        description={
          paymentsConnected
            ? `You can't undo this yourself. Only the new owner can transfer it back. Your Stripe account stays connected, and new checkouts pause until ${newOwnerName} keeps it or connects their own.`
            : "You can't undo this yourself. Only the new owner can transfer it back."
        }
        confirmLabel="Transfer ownership"
        pendingLabel="Transferring…"
        danger
        typeToConfirm={name}
        onConfirm={(typed) =>
          transferOwnershipAction({ slug, userId: newOwner, confirmName: typed })
        }
        onDone={() => router.refresh()}
      />
      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={close}
        title={`Archive ${name}?`}
        description="Everything stays and members can still read it. No one can join, post, comment, react, RSVP, or record progress, and invite links stop working until you restore it."
        confirmLabel="Archive community"
        pendingLabel="Archiving…"
        onConfirm={() =>
          setArchivedAction({
            slug,
            archived: true,
            ...(paying > 0 ? { paidMembers: choice, includeLinked: !leaveLinked } : {}),
            ...(askWhy ? { exit: exitAnswer(archiveWhy) } : {}),
          })
        }
        onDone={() => router.refresh()}
      >
        {paying > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">{payingMembers(paying)}</p>
            <RadioCards
              legend="What happens to paying members"
              name="paid-members"
              value={choice}
              options={archiveChoices}
              onChange={setChoice}
              columns={2}
            />
            {linkedImports > 0 ? (
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
          </div>
        ) : null}
        {askWhy ? (
          <ExitReasonFields
            question="Why are you archiving?"
            value={archiveWhy}
            onChange={setArchiveWhy}
          />
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "stop"}
        onOpenChange={close}
        title="Stop renewals at period end?"
        description={`${payingMembers(paying)} Every subscription ends at the end of its current period and does not renew. Members can read the community until then.`}
        confirmLabel="Stop renewals"
        pendingLabel="Stopping renewals…"
        onConfirm={() =>
          setArchivedAction({ slug, archived: true, paidMembers: "stop_at_period_end" })
        }
        onDone={() => router.refresh()}
      />
      <ConfirmDialog
        open={dialog === "unarchive"}
        onOpenChange={close}
        title={`Restore ${name}?`}
        description={
          ending > 0
            ? `Members can post, comment, and RSVP again. People can join and invite links work. ${subscriptionsWord(ending)} ${ending === 1 ? "is" : "are"} set to end. To keep them, turn renewal back on in your Stripe Dashboard.`
            : "Members can post, comment, and RSVP again. People can join and invite links work."
        }
        confirmLabel="Restore community"
        pendingLabel="Restoring…"
        onConfirm={() => setArchivedAction({ slug, archived: false })}
        onDone={() => router.refresh()}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete ${name} for good?`}
        description="Posts, courses, events, and memberships are deleted and can't be recovered. Download your members CSV before you continue."
        confirmLabel="Delete community"
        pendingLabel="Deleting…"
        danger
        typeToConfirm={name}
        confirmBlocked={needsManualCancellation && !cancelledInStripe}
        onConfirm={(typed) =>
          deleteCommunityAction({
            slug,
            confirmName: typed,
            includeLinked: !deleteLeavesLinked,
            confirmedManualCancellation: needsManualCancellation && cancelledInStripe,
            ...(askWhy ? { exit: exitAnswer(deleteWhy) } : {}),
          })
        }
        onDone={() => router.refresh()}
      >
        {paying > 0 && paidMembers?.connection === "open" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">
              {payingMembers(cancelledNow)} Their subscriptions are cancelled now and they are not
              charged again.
            </p>
            {linkedImports > 0 ? (
              <label className="flex min-h-11 items-start gap-3 text-sm text-text">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-accent"
                  checked={deleteLeavesLinked}
                  onChange={(event) => setDeleteLeavesLinked(event.target.checked)}
                />
                <span>
                  Leave {subscriptionsWord(linkedImports)} you linked from before Cohory running in
                  your Stripe account
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        {needsManualCancellation ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">
              {paidMembers?.connection === "closed"
                ? "Stripe is disconnected, so Cohory can't cancel subscriptions. When Stripe was last connected, Cohory counted"
                : "An earlier Stripe account is disconnected, so Cohory can't cancel its subscriptions. When it was last connected, Cohory counted"}{" "}
              {payingMembers(manualCancellation)}
            </p>
            <label className="flex min-h-11 items-start gap-3 text-sm text-text">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-accent"
                checked={cancelledInStripe}
                onChange={(event) => setCancelledInStripe(event.target.checked)}
              />
              <span>I cancelled these subscriptions in my Stripe Dashboard</span>
            </label>
          </div>
        ) : null}
        {askWhy ? (
          <ExitReasonFields
            question="Why are you deleting it?"
            value={deleteWhy}
            onChange={setDeleteWhy}
          />
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
