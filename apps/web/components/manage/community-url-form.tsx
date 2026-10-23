"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { changeSlugAction } from "../../lib/manage/slug-actions";
import { ConfirmDialog } from "./confirm-dialog";

export interface CommunityUrlFormProps {
  readonly slug: string;
  readonly origin: string;
  readonly isOwner: boolean;
  readonly canChange: boolean;
  readonly nextChangeLabel: string | null;
}

export function CommunityUrlForm({
  slug,
  origin,
  isOwner,
  canChange,
  nextChangeLabel,
}: CommunityUrlFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(slug);
  const [confirming, setConfirming] = useState(false);
  const next = value.trim().toLowerCase();
  const editable = isOwner && canChange;
  const prefix = `${origin}/c/`;

  function review(event: FormEvent) {
    event.preventDefault();
    if (next !== slug) {
      setConfirming(true);
    }
  }

  const help = !isOwner
    ? "Only the owner can change the community URL."
    : nextChangeLabel
      ? `You can change it again on ${nextChangeLabel}.`
      : "You can change it once every 30 days. Old links keep working.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Community URL</CardTitle>
        <CardDescription>
          The address people use to open your community. Links that use an old URL take people to
          the new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={review} className="flex flex-col gap-4">
          <Field label="Community URL" description={help}>
            {(control) => (
              <div className="flex min-h-11 w-full items-stretch overflow-hidden rounded-md border border-input bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
                <span className="flex max-w-[55%] items-center truncate border-r border-input bg-surface-hover px-3 text-sm text-text-muted">
                  {prefix}
                </span>
                <input
                  {...control}
                  value={value}
                  readOnly={!editable}
                  aria-readonly={!editable}
                  minLength={3}
                  maxLength={48}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  onChange={(event) => setValue(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-3 text-base text-text outline-none read-only:text-text-muted"
                />
              </div>
            )}
          </Field>
          {editable ? (
            <Button
              type="submit"
              variant="secondary"
              disabled={next === slug}
              className="min-h-11 self-start"
            >
              Change URL
            </Button>
          ) : null}
        </form>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change the URL to ${prefix}${next}?`}
        description="Links that use the old URL, including shared invite links, keep working and take people to the new one. You can change the URL again after 30 days. The old URL stays reserved for this community."
        confirmLabel="Change URL"
        pendingLabel="Changing…"
        onConfirm={() => changeSlugAction({ slug, newSlug: next })}
        onDone={() => router.replace(`/c/${next}/manage/settings`)}
      />
    </Card>
  );
}
