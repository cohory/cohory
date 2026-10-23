"use client";

import { useId, type RefObject } from "react";

import { Button } from "../primitives/button";
import { RelativeTime } from "./relative-time";

interface MemberEmailStatus {
  lastSentAt: string | Date | null;
  nextAvailableAt: string | Date | null;
}

function MemberEmailField({
  status,
  checked,
  disabled,
  onChange,
}: {
  status: MemberEmailStatus;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  const hintId = useId();
  const waiting = status.nextAvailableAt !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <label className="flex min-h-11 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={checked && !waiting}
          disabled={disabled || waiting}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.checked)}
        />
        Also email all members
      </label>
      <span id={hintId} className="text-xs text-text-muted">
        {status.lastSentAt ? (
          <>
            Last used <RelativeTime value={status.lastSentAt} />.{" "}
          </>
        ) : (
          "Not used yet. "
        )}
        {waiting ? "You can send one email to all members a day." : null}
      </span>
    </div>
  );
}

function DraftRestoreOffer({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore(): void;
  onDiscard(): void;
}) {
  return (
    <div
      role="group"
      aria-label="Unsaved draft"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-hover p-3 text-sm"
    >
      <span className="text-text">You have an unsaved post from {savedAt}.</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onRestore}>
          Restore draft
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard draft
        </Button>
      </div>
    </div>
  );
}

function DiscardConfirm({
  keepRef,
  onKeep,
  onDiscard,
}: {
  keepRef: RefObject<HTMLButtonElement | null>;
  onKeep(): void;
  onDiscard(): void;
}) {
  return (
    <div
      role="group"
      aria-label="Discard this post?"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-muted p-3 text-sm"
    >
      <span className="text-text">Discard this post?</span>
      <div className="flex gap-2">
        <Button ref={keepRef} variant="secondary" size="sm" onClick={onKeep}>
          Keep editing
        </Button>
        <Button variant="ghost" size="sm" className="text-danger" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}

export { DiscardConfirm, DraftRestoreOffer, MemberEmailField, type MemberEmailStatus };
