"use client";

import { Button, Input, Textarea, type MentionResolver } from "@cohory/ui";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { useId, useState } from "react";

import { updatePostAction } from "../../lib/posts/actions";
import { documentImages, documentToText } from "../../lib/posts/document";
import type { FeedPost } from "../../lib/posts/views";
import { composeWithMentions } from "./compose";

export function EditPostForm({
  slug,
  post,
  resolveMention,
  onDone,
}: {
  slug: string;
  post: FeedPost;
  resolveMention: MentionResolver;
  onDone(saved: boolean): void;
}) {
  const [original] = useState(() => documentToText(post.content));
  const [title, setTitle] = useState(post.title ?? "");
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const images = documentImages(post.content);
  const errorId = useId();
  useUnsavedChanges(!saving && (title !== (post.title ?? "") || text !== original));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const document = await composeWithMentions(text, images, resolveMention);
      const result = await updatePostAction({
        slug,
        postId: post.id,
        title: title.trim() === "" ? null : title,
        document,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone(true);
    } catch {
      setError("We couldn't save your changes. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="Edit post"
      className="flex flex-col gap-3 border-y border-border bg-surface p-4 md:rounded-(--card-radius) md:border-x md:shadow-(--card-shadow)"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.preventDefault();
          onDone(false);
        }
      }}
    >
      <Input
        aria-label="Title (optional)"
        placeholder="Title (optional)"
        value={title}
        maxLength={120}
        readOnly={saving}
        onChange={(event) => setTitle(event.target.value)}
        className="text-lg font-semibold"
      />
      <Textarea
        aria-label="Post"
        autoFocus
        value={text}
        readOnly={saving}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setText(event.target.value)}
        className="min-h-40 resize-y"
      />
      {images.length > 0 ? (
        <p className="text-sm text-text-muted">
          {images.length === 1 ? "The image stays as it is." : "The images stay as they are."}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 -mb-4 flex justify-end gap-2 border-t border-border bg-surface px-4 py-3 md:static md:mx-0 md:mb-0 md:border-0 md:p-0">
        <Button type="button" variant="ghost" disabled={saving} onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving || (text.trim() === "" && images.length === 0)}
          aria-busy={saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
