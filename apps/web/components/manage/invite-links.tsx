"use client";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Label,
  Select,
  Switch,
} from "@cohory/ui";
import { formatDate } from "@cohory/ui/lib/format-date";
import { ChevronDown, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, useTransition } from "react";

import { createInviteAction, revokeInviteAction } from "../../lib/manage/actions";
import type { InviteRow } from "../../lib/manage/views";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyButton } from "./copy-button";
import { markSetupAction } from "./overview/actions";

const expiryOptions = [
  { value: "", label: "Never" },
  { value: "1", label: "In 1 day" },
  { value: "7", label: "In 7 days" },
  { value: "30", label: "In 30 days" },
] as const;

const inactiveLabels: Record<Exclude<InviteRow["status"], "active">, string> = {
  revoked: "Revoked",
  expired: "Expired",
  used_up: "Used up",
};

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function invitedByHash(): boolean {
  return window.location.hash === "#invite";
}

function usesLabel(invite: InviteRow): string {
  return invite.maxUses === null
    ? `Used ${invite.useCount} ${invite.useCount === 1 ? "time" : "times"}`
    : `${invite.useCount} of ${invite.maxUses} uses`;
}

export const paidInviteApprovalReason =
  "Paid communities: payment is the approval, so invite links never need approval.";

function inviteSummary(invite: InviteRow, planOnSale: boolean): string {
  const expiry = invite.expiresAt
    ? `expires ${formatDate(invite.expiresAt, { timeZone: "UTC" })}`
    : "never expires";
  const approval = invite.requiresApproval && !planOnSale ? ", needs approval" : "";
  return `${usesLabel(invite)}, ${expiry}${approval}`;
}

function InactiveInvites({ invites }: { invites: InviteRow[] }) {
  const [chosen, setOpen] = useState<boolean | null>(null);
  const linkedOpen = useSyncExternalStore(subscribeHash, invitedByHash, () => false);
  const open = chosen ?? linkedOpen;
  if (invites.length === 0) {
    return null;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="min-h-11 px-2">
          <ChevronDown
            aria-hidden="true"
            className={open ? "size-4 rotate-180" : "size-4"}
            strokeWidth={1.5}
          />
          Revoked and expired links ({invites.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-2 pt-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium text-text">{invite.label ?? "Unnamed link"}</p>
              <p className="text-text-muted">
                {invite.status === "active" ? "Active" : inactiveLabels[invite.status]}
                {invite.revokedAt
                  ? ` ${formatDate(invite.revokedAt, { timeZone: "UTC" })}`
                  : ""}, {usesLabel(invite).toLowerCase()}
              </p>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function InviteLinks({
  slug,
  invites,
  planOnSale = false,
}: {
  slug: string;
  invites: InviteRow[];
  planOnSale?: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const approvalId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<InviteRow | null>(null);
  const [open, setOpen] = useState(false);
  const active = invites.filter((invite) => invite.status === "active");
  const inactive = invites.filter((invite) => invite.status !== "active");

  function create() {
    const uses = maxUses.trim() === "" ? null : Number(maxUses);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      setError("Enter a whole number of uses, or leave it empty for no limit.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createInviteAction({
        slug,
        expiresInDays: expiry === "" ? null : Number(expiry),
        maxUses: uses,
        requiresApproval: requiresApproval && !planOnSale,
        label,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMaxUses("");
      setLabel("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="min-h-11">
          <UserPlus aria-hidden="true" className="size-4" strokeWidth={1.5} />
          Invite people
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invite links</DialogTitle>
          <DialogDescription>
            {planOnSale ? (
              <>
                People with this link still pay to join. To let someone in for free, use{" "}
                <Link href={`/c/${encodeURIComponent(slug)}/manage/payments`} className="text-link">
                  Free access in Payments
                </Link>
                .
              </>
            ) : (
              "Anyone with an active link can join, even when the community is private or needs approval. Turn on approval for a link to review the people who use it."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name (optional)"
              description="Only you and your team see it, for example Instagram bio."
              className="sm:col-span-2"
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={60}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              )}
            </Field>
            <Field label="Link expires">
              {(control) => (
                <Select
                  {...control}
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                >
                  {expiryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Most uses (optional)">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  placeholder="No limit"
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <Switch
                  id={approvalId}
                  checked={requiresApproval && !planOnSale}
                  disabled={planOnSale}
                  aria-describedby={planOnSale ? `${approvalId}-reason` : undefined}
                  onCheckedChange={setRequiresApproval}
                />
                <Label htmlFor={approvalId}>People who use this link need approval</Label>
              </div>
              {planOnSale ? (
                <p id={`${approvalId}-reason`} className="text-sm text-text-muted">
                  {paidInviteApprovalReason}
                </p>
              ) : null}
            </div>
            <Button type="button" onClick={create} disabled={pending} className="min-h-11">
              {pending ? "Creating link…" : "Create invite link"}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {active.length === 0 ? (
            <p className="text-sm text-text-muted">No active invite links yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {active.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  {invite.label ? (
                    <p className="text-sm font-medium text-text">{invite.label}</p>
                  ) : null}
                  <Input
                    readOnly
                    value={invite.url}
                    aria-label="Invite link"
                    onFocus={(event) => event.target.select()}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-text-muted">{inviteSummary(invite, planOnSale)}</p>
                    <div className="flex gap-2">
                      <CopyButton
                        value={invite.url}
                        onCopied={() => {
                          void markSetupAction({ slug, mark: "invite_link_copied" });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11"
                        onClick={() => setRevoking(invite)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <InactiveInvites invites={inactive} />
        </div>
        <ConfirmDialog
          open={revoking !== null}
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          title="Revoke this invite link?"
          description="People who open it won't be able to join. Members who already joined stay."
          confirmLabel="Revoke link"
          pendingLabel="Revoking link…"
          danger
          onConfirm={() => revokeInviteAction({ slug, inviteId: revoking?.id ?? "" })}
          onDone={() => router.refresh()}
        />
      </DialogContent>
    </Dialog>
  );
}
