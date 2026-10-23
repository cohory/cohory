"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  type MentionResolver,
} from "@cohory/ui";
import { useState } from "react";

import { updateCommentAction } from "../../lib/posts/actions";
import { documentToText } from "../../lib/posts/document";
import type { FeedComment } from "../../lib/posts/views";
import { composeWithMentions } from "./compose";

export function EditCommentDialog({
  slug,
  comment,
  resolveMention,
  onClose,
}: {
  slug: string;
  comment: FeedComment;
  resolveMention: MentionResolver;
  onClose(saved: boolean): void;
}) {
  const [text, setText] = useState(() => documentToText(comment.content));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const document = await composeWithMentions(text, [], resolveMention, "paragraphs");
      const result = await updateCommentAction({ slug, commentId: comment.id, document });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose(false))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit comment</DialogTitle>
        </DialogHeader>
        <Textarea
          aria-label="Comment"
          value={text}
          readOnly={saving}
          onChange={(event) => setText(event.target.value)}
          className="min-h-28"
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || text.trim() === ""}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
