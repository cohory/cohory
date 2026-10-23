"use client";

import { Badge, Button, Field, Input, RelativeTime, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import {
  grantCompAction,
  revokeCompAction,
  withdrawCompInvitationAction,
} from "../../lib/payments/comp-actions";
import { ConfirmDialog } from "../manage/confirm-dialog";

export interface CompRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly note: string | null;
  readonly expiresAt: string | null;
  readonly status: "active" | "expired" | "revoked";
  readonly grantedBy: string | null;
}

export interface CompInvitationRow {
  readonly id: string;
  readonly email: string;
  readonly note: string | null;
  readonly expiresAt: string | null;
  readonly grantedBy: string | null;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function GrantForm({ slug, invites }: { slug: string; invites: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await grantCompAction({ slug, email, until, note });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setEmail("");
      setUntil("");
      setNote("");
      toast.success(
        result.data === "invited"
          ? "Invitation sent. Access starts when they accept it."
          : "Free access granted.",
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Grant free access">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Email address"
          {...(invites
            ? { description: "We email them an offer. Free access starts when they accept it." }
            : {})}
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Free until (optional)" description="Leave empty for no end date.">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Note (optional)" description="Only admins and the owner see it.">
        {(control) => (
          <Input
            {...control}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 self-start">
        {pending
          ? invites
            ? "Sending…"
            : "Granting"
          : invites
            ? "Send offer"
            : "Grant free access"}
      </Button>
    </form>
  );
}

function CompItem({ slug, row }: { slug: string; row: CompRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-text">{row.name}</span>
          <Badge variant="accent">Comped</Badge>
          {row.status === "expired" ? <Badge variant="neutral">Ended</Badge> : null}
        </div>
        <span className="truncate text-sm text-text-muted">{row.email}</span>
        <span className="text-sm text-text-muted">
          {row.expiresAt ? (
            <>
              Free until {dateFormat.format(new Date(row.expiresAt))} (
              <RelativeTime value={row.expiresAt} />)
            </>
          ) : (
            "No end date"
          )}
          {row.grantedBy ? ` · Granted by ${row.grantedBy}` : null}
          {row.note ? ` · ${row.note}` : null}
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        onClick={() => setConfirming(true)}
      >
        Revoke
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Revoke free access for ${row.name}?`}
        description="They lose access right away unless they also pay or are on the team."
        confirmLabel="Revoke access"
        pendingLabel="Revoking…"
        danger
        onConfirm={() => revokeCompAction({ slug, compId: row.id })}
        onDone={() => {
          toast.success("Free access revoked.");
          router.refresh();
        }}
      />
    </li>
  );
}

function InvitationItem({ slug, row }: { slug: string; row: CompInvitationRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-text">{row.email}</span>
          <Badge variant="neutral">Invited</Badge>
        </div>
        <span className="text-sm text-text-muted">
          {row.expiresAt
            ? `Free until ${dateFormat.format(new Date(row.expiresAt))}`
            : "No end date"}
          {row.grantedBy ? ` · Invited by ${row.grantedBy}` : null}
          {row.note ? ` · ${row.note}` : null}
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        onClick={() => setConfirming(true)}
      >
        Withdraw
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Withdraw the invitation for ${row.email}?`}
        description="The link in their email stops working. You can invite them again later."
        confirmLabel="Withdraw invitation"
        pendingLabel="Withdrawing…"
        danger
        onConfirm={() => withdrawCompInvitationAction({ slug, invitationId: row.id })}
        onDone={() => {
          toast.success("Invitation withdrawn.");
          router.refresh();
        }}
      />
    </li>
  );
}

export function CompedMembers({
  slug,
  rows,
  invitations,
  invites,
}: {
  slug: string;
  rows: readonly CompRow[];
  invitations: readonly CompInvitationRow[];
  invites: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && invitations.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody has free access yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul aria-label="Comped members" className="flex flex-col">
          {rows.map((row) => (
            <CompItem key={row.id} slug={slug} row={row} />
          ))}
        </ul>
      ) : null}
      {invitations.length > 0 ? (
        <ul aria-label="Pending invitations" className="flex flex-col">
          {invitations.map((row) => (
            <InvitationItem key={row.id} slug={slug} row={row} />
          ))}
        </ul>
      ) : null}
      <GrantForm slug={slug} invites={invites} />
    </div>
  );
}
