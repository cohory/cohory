"use client";

import { AgentBadge, Button } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { discardDraftAction, publishDraftAction } from "../../lib/agents/actions";
import { ConfirmDialog } from "../feed/confirm-dialog";
import { formatDay } from "./format";

export interface DraftItem {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly authorName: string;
  readonly agentName: string | null;
  readonly categoryName: string | null;
  readonly createdAt: string;
}

export function AgentDrafts({ slug, drafts }: { slug: string; drafts: readonly DraftItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [discarding, setDiscarding] = useState<DraftItem | null>(null);

  function act(action: typeof publishDraftAction, draftId: string) {
    startTransition(async () => {
      const result = await action({ slug, draftId });
      setError(result.ok ? null : result.message);
      if (result.ok) router.refresh();
    });
  }

  async function discard(draftId: string) {
    const result = await discardDraftAction({ slug, draftId });
    setError(result.ok ? null : result.message);
    setDiscarding(null);
    if (result.ok) router.refresh();
  }

  return (
    <section aria-labelledby="drafts-heading" className="flex flex-col gap-3">
      <h4 id="drafts-heading" className="text-lg text-text">
        Drafts waiting for you
      </h4>
      {drafts.length === 0 ? (
        <p className="text-sm text-text-muted">No drafts. Posts your agents write show up here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <li key={draft.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-text">{draft.authorName}</span>
                {draft.agentName ? <AgentBadge name={draft.agentName} /> : null}
                <span className="text-text-muted">{formatDay(draft.createdAt)}</span>
                {draft.categoryName ? (
                  <span className="text-text-muted">in {draft.categoryName}</span>
                ) : null}
              </div>
              {draft.title ? (
                <p className="font-medium break-words text-text">{draft.title}</p>
              ) : null}
              <p className="text-sm break-words text-text-muted">{draft.excerpt}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  className="min-h-11"
                  onClick={() => act(publishDraftAction, draft.id)}
                >
                  Publish draft
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  className="min-h-11"
                  onClick={() => setDiscarding(draft)}
                >
                  Discard draft
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
        title="Discard this draft?"
        description="The draft is deleted and cannot be published later."
        confirmLabel="Discard draft"
        onConfirm={() => (discarding ? discard(discarding.id) : Promise.resolve())}
      />
    </section>
  );
}
