"use client";

import { Button, Field, RelativeTime, Textarea, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decideJoinRequestAction, decideJoinRequestsAction } from "../../lib/manage/join-actions";

export interface JoinRequestRow {
  readonly id: string;
  readonly name: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly createdAt: string;
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
}

function RequestItem({
  slug,
  request,
  selected,
  onSelect,
}: {
  slug: string;
  request: JoinRequestRow;
  selected: boolean;
  onSelect(checked: boolean): void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approve" | "decline") {
    startTransition(async () => {
      const result = await decideJoinRequestAction({
        slug,
        requestId: request.id,
        decision,
        note,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(
        decision === "approve" ? `${request.name} is now a member.` : "Request declined.",
      );
      router.refresh();
    });
  }

  return (
    <li
      aria-label={`Request from ${request.name}`}
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            aria-label={`Select ${request.name}`}
            className="mt-1 size-4 shrink-0 accent-accent"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
          <div className="flex min-w-0 flex-col">
            <p className="truncate font-medium text-text">{request.name}</p>
            <p className="truncate text-sm text-text-muted">
              {[request.username ? `@${request.username}` : null, request.email]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <p className="text-sm text-text-muted">
          Requested <RelativeTime value={request.createdAt} />
        </p>
      </div>
      {request.answers.length > 0 ? (
        <dl className="flex flex-col gap-3 text-sm">
          {request.answers.map((answer) => (
            <div key={answer.question} className="flex flex-col gap-1">
              <dt className="text-text-muted">{answer.question}</dt>
              <dd className="whitespace-pre-line break-words text-text">
                {answer.answer || "No answer"}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-text-muted">No join questions were asked.</p>
      )}
      <Field label="Note to the person (optional)" description="Shown to them on the About page.">
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
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={pending}
          onClick={() => decide("approve")}
        >
          Approve {request.name}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => decide("decline")}
        >
          Decline
        </Button>
      </div>
    </li>
  );
}

export function JoinRequests({
  slug,
  requests,
  pendingCount,
}: {
  slug: string;
  requests: readonly JoinRequestRow[];
  pendingCount: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) {
    return <p className="text-sm text-text-muted">No one is waiting to join.</p>;
  }

  const ids = requests.map((request) => request.id).filter((id) => selected.has(id));
  const allSelected = ids.length === requests.length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function decideSelected(decision: "approve" | "decline") {
    startTransition(async () => {
      const result = await decideJoinRequestsAction({ slug, requestIds: ids, decision });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const done = result.data.done.length;
      const failed = result.data.failed.length;
      setError(
        failed > 0
          ? `${failed} ${failed === 1 ? "request" : "requests"} could not be decided. Someone may have decided them already, or the community is full.`
          : null,
      );
      if (done > 0) {
        toast.success(
          decision === "approve"
            ? `${done} ${done === 1 ? "person is" : "people are"} now members.`
            : `${done} ${done === 1 ? "request" : "requests"} declined.`,
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {pendingCount > requests.length ? (
        <p className="text-sm text-text-muted">
          Showing the oldest {requests.length} of {pendingCount} requests.
        </p>
      ) : null}
      <div className="flex min-h-11 flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={allSelected}
            onChange={(event) =>
              setSelected(
                event.target.checked ? new Set(requests.map((request) => request.id)) : new Set(),
              )
            }
          />
          Select all shown
        </label>
        {ids.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={() => decideSelected("approve")}
            >
              {pending ? "Saving…" : `Approve selected (${ids.length})`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => decideSelected("decline")}
            >
              Decline selected
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {requests.map((request) => (
          <RequestItem
            key={request.id}
            slug={slug}
            request={request}
            selected={selected.has(request.id)}
            onSelect={(checked) => toggle(request.id, checked)}
          />
        ))}
      </ul>
    </div>
  );
}
