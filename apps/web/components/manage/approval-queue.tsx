"use client";

import {
  AgentBadge,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  RelativeTime,
  Textarea,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  approveRequestAction,
  rejectRequestAction,
  signInAgainAction,
} from "../../lib/manage/approval-actions";
import type { ApprovalRow } from "../../lib/manage/approvals";
import { CopyButton } from "./copy-button";

export interface RecentAgentAction {
  readonly id: string;
  readonly label: string;
  readonly at: string;
}

export type RecentAgentActions = Readonly<Record<string, readonly RecentAgentAction[]>>;

function Asker({ row }: { row: ApprovalRow }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
      <span className="font-medium text-text">{row.agentName}</span>
      <AgentBadge name={row.agentName} />
      <span>for {row.ownerName}</span>
      <span aria-hidden="true">·</span>
      <span>
        Asked <RelativeTime value={row.createdAt} />
      </span>
    </p>
  );
}

function RecentActions({
  agentName,
  items,
}: {
  agentName: string;
  items: readonly RecentAgentAction[];
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-text">Last actions by {agentName}</p>
      {items.length === 0 ? (
        <p className="text-text-muted">Nothing yet. This is its first action here.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-text-muted">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap gap-x-2">
              <span className="text-text">{item.label}</span>
              <RelativeTime value={item.at} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfirmApprove({
  row,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  row: ApprovalRow;
  open: boolean;
  pending: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve this request?</DialogTitle>
          <DialogDescription>
            {row.summary}. It runs right away as you, with your permissions, and cannot be undone
            from here.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            className="min-h-11"
            disabled={pending}
            onClick={onConfirm}
          >
            Yes, approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Changes({ row }: { row: ApprovalRow }) {
  if (row.diff.length === 0) {
    return null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">What changes</caption>
        <thead className="text-text-muted">
          <tr>
            <th scope="col" className="py-1 pr-3 font-normal">
              What
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              Now
            </th>
            <th scope="col" className="py-1 font-normal">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {row.diff.map((line) => (
            <tr key={line.label} className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-medium text-text">
                {line.label}
              </th>
              <td className="py-2 pr-3 break-words text-text-muted">{line.before ?? "Not set"}</td>
              <td className="py-2 break-words text-text">{line.after ?? "Not set"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingItem({
  slug,
  row,
  recent,
}: {
  slug: string;
  row: ApprovalRow;
  recent: readonly RecentAgentAction[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ message: string; reauth: boolean } | null>(null);
  const [revealed, setRevealed] = useState<Readonly<Record<string, string>> | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setConfirming(false);
    startTransition(async () => {
      const result = await approveRequestAction({ slug, approvalId: row.id });
      if (!result.ok) {
        setError({ message: result.message, reauth: result.reauth === true });
        return;
      }
      setError(null);
      if (result.data.revealed) {
        setRevealed(result.data.revealed);
        return;
      }
      toast.success(result.data.state === "executed" ? "Approved and done." : "Decision saved.");
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectRequestAction({ slug, approvalId: row.id, note });
      if (!result.ok) {
        setError({ message: result.message, reauth: false });
        return;
      }
      toast.success("Request rejected.");
      router.refresh();
    });
  }

  return (
    <li
      aria-label={row.summary}
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.serious ? "warning" : "neutral"}>{row.riskLabel}</Badge>
          <p className="font-medium break-words text-text">{row.summary}</p>
        </div>
        <Asker row={row} />
        <p className="text-sm text-text-muted">Expires {row.expiresLabel} if nobody decides.</p>
      </div>
      <Changes row={row} />
      <RecentActions agentName={row.agentName} items={recent} />
      {row.executable ? null : (
        <p className="text-sm text-text-muted">
          Agents cannot do this yet. Reject it and do it yourself if you want it.
        </p>
      )}
      {row.agentActive ? null : (
        <p className="text-sm text-text-muted">
          This agent is paused or revoked. Approving rejects the request instead.
        </p>
      )}
      {revealed ? (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm text-text">
            Done. Copy this signing secret now. It is shown only once.
          </p>
          {Object.entries(revealed).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-2">
              <code className="break-all rounded-sm bg-surface-hover px-2 py-1 font-mono text-sm text-text">
                {value}
              </code>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={value} label="Copy secret" copiedMessage="Secret copied." />
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => router.refresh()}
                >
                  I saved it
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Field label="Note to the agent (optional)" description="Shown with a rejection.">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-sm text-danger">{error.message}</p>
              {error.reauth ? (
                <form action={signInAgainAction.bind(null, slug)}>
                  <Button type="submit" variant="secondary" className="min-h-11">
                    Sign in again
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {row.executable && row.agentActive ? (
              <Button
                type="button"
                variant={row.serious ? "danger" : "primary"}
                className="min-h-11"
                disabled={pending}
                onClick={row.serious ? () => setConfirming(true) : approve}
              >
                Approve
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={reject}
            >
              Reject
            </Button>
          </div>
        </>
      )}
      {row.serious ? (
        <ConfirmApprove
          row={row}
          open={confirming}
          pending={pending}
          onOpenChange={setConfirming}
          onConfirm={approve}
        />
      ) : null}
    </li>
  );
}

export function PendingApprovals({
  slug,
  rows,
  recent = {},
}: {
  slug: string;
  rows: readonly ApprovalRow[];
  recent?: RecentAgentActions;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Nothing is waiting. Requests from agents appear here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <PendingItem key={row.id} slug={slug} row={row} recent={recent[row.agentId] ?? []} />
      ))}
    </ul>
  );
}

const stateLabels: Record<ApprovalRow["state"], string> = {
  pending: "Waiting",
  approved: "Running",
  executed: "Done",
  failed: "Could not run",
  rejected: "Rejected",
  expired: "Expired",
};

export function ApprovalHistory({ rows }: { rows: readonly ApprovalRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">No decisions yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={row.id}
          aria-label={row.summary}
          className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium break-words text-text">{row.summary}</p>
            <span className="text-sm text-text-muted">{stateLabels[row.state]}</span>
          </div>
          <Asker row={row} />
          <Changes row={row} />
          <p className="text-sm break-words text-text">{row.outcome}</p>
        </li>
      ))}
    </ul>
  );
}
