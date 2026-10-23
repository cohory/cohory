"use client";

import { Button, Field, Textarea, toast } from "@cohory/ui";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { deleteReviewAction, saveReviewAction } from "../../lib/reviews/actions";
import { hiddenReasonLabels } from "../../lib/reviews/views";
import { ConfirmDialog } from "../manage/confirm-dialog";

interface ExistingReview {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
  readonly hiddenReason: keyof typeof hiddenReasonLabels | null;
}

const maxLength = 2000;

function StarInput({ value, onChange }: { value: number; onChange(value: number): void }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-text">Your rating</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((stars) => (
          <label
            key={stars}
            className="relative inline-flex size-11 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={stars}
              checked={value === stars}
              onChange={() => onChange(stars)}
              className="sr-only"
            />
            <span className="sr-only">{stars === 1 ? "1 star" : `${stars} stars`}</span>
            <Star
              aria-hidden="true"
              strokeWidth={1.5}
              className={
                stars <= value ? "size-6 fill-warning text-warning" : "size-6 text-text-subtle"
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ReviewForm({ slug, existing }: { slug: string; existing: ExistingReview | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(existing === null);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    if (rating === 0) {
      setError("Choose 1 to 5 stars.");
      return;
    }
    startTransition(async () => {
      const result = await saveReviewAction({
        slug,
        rating,
        body,
        ...(existing ? { reviewId: existing.id } : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success(existing ? "Review updated." : "Thanks for your review.");
      setEditing(false);
      router.refresh();
    });
  }

  if (existing && !editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-4">
        <p className="text-sm font-medium text-text">You reviewed this community.</p>
        {existing.hiddenReason ? (
          <p className="text-sm text-text-muted">
            The owner hid your review for: {hiddenReasonLabels[existing.hiddenReason]}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            Edit your review
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => setDeleting(true)}>
            Delete your review
          </Button>
        </div>
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete your review?"
          description="Your review and any reply to it are removed. You can write a new one later while you are a paying member."
          confirmLabel="Delete review"
          pendingLabel="Deleting…"
          danger
          onConfirm={() => deleteReviewAction({ slug, reviewId: existing.id })}
          onDone={() => {
            toast.success("Review deleted.");
            setDeleting(false);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <form
      aria-label={existing ? "Edit your review" : "Write a review"}
      className="flex flex-col gap-4 rounded-md border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <StarInput value={rating} onChange={setRating} />
      <Field label="Your review" description="20 to 2000 characters. Other people will see it.">
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            minLength={20}
            maxLength={maxLength}
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={pending}>
          {existing ? "Save review" : "Post review"}
        </Button>
        {existing ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              setRating(existing.rating);
              setBody(existing.body);
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
