"use client";

import { Badge, Button, PostComposer, toast, type PostComposerCategory } from "@cohory/ui";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";
import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  cancelScheduledPostAction,
  publishScheduledPostAction,
  updateScheduledPostAction,
} from "../../lib/posts/actions";
import { documentImages, documentToText } from "../../lib/posts/document";
import type { ScheduledPostRow } from "../../lib/posts/load";
import { EmptyState } from "../empty-state";
import { mentionResolver, mentionSearch, uploadPostImage } from "./client-helpers";
import { ConfirmDialog } from "./confirm-dialog";

function EditScheduledForm({
  slug,
  row,
  categories,
  onDone,
}: {
  slug: string;
  row: ScheduledPostRow;
  categories: readonly PostComposerCategory[];
  onDone(saved: boolean): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const resolveMention = useMemo(() => mentionResolver(slug), [slug]);
  const searchMentions = useMemo(() => mentionSearch(slug), [slug]);
  const [initial] = useState(() => ({
    title: row.post.title,
    text: documentToText(row.post.content),
    categoryId: row.categoryId,
    scheduledAt: row.scheduledAt,
    images: documentImages(row.post.content),
  }));

  return (
    <PostComposer
      initial={initial}
      label="Edit scheduled post"
      submitLabel="Save changes"
      allowSchedule
      categories={categories}
      error={error}
      onUploadImage={(file) => uploadPostImage(slug, file)}
      onResolveMention={resolveMention}
      onSearchMentions={searchMentions}
      onCancel={() => onDone(false)}
      className="border-0 p-0 shadow-none md:border-0 md:shadow-none"
      onSubmit={async ({ title, document, categoryId, scheduledAt }) => {
        if (!scheduledAt) return;
        setError(null);
        const result = await updateScheduledPostAction({
          slug,
          postId: row.post.id,
          title,
          document,
          categoryId,
          scheduledAt,
        });
        if (!result.ok) {
          setError(result.message);
          throw new Error(result.message);
        }
        onDone(true);
      }}
    />
  );
}

export function ScheduledPosts({
  slug,
  rows,
  categories,
  showAuthors,
  timeZone,
}: {
  slug: string;
  rows: readonly ScheduledPostRow[];
  categories: readonly PostComposerCategory[];
  showAuthors: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduledPostRow | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState<ScheduledPostRow | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

  async function publishNow(row: ScheduledPostRow) {
    setPublishing(row.post.id);
    try {
      const result = await publishScheduledPostAction({ slug, postId: row.post.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmingPublish(null);
      toast.success("Posted.");
      router.push(`/c/${slug}/posts/${row.post.id}`);
    } finally {
      setPublishing(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={CalendarClock} title="No scheduled posts">
        Use the calendar button in the composer to publish a post later.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Scheduled posts">
        {rows.map((row) => (
          <li
            key={row.post.id}
            className="flex flex-col gap-3 border-y border-border bg-surface p-4 md:rounded-(--card-radius) md:border-x md:shadow-(--card-shadow)"
          >
            {editing === row.post.id ? (
              <EditScheduledForm
                slug={slug}
                row={row}
                categories={categories}
                onDone={(saved) => {
                  setEditing(null);
                  if (saved) {
                    toast.success("Scheduled post saved.");
                    router.refresh();
                  }
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <Badge variant="accent">Scheduled</Badge>
                  <time dateTime={row.scheduledAt}>
                    {formatDateTimeWithZone(row.scheduledAt, { timeZone, style: "full" })}
                  </time>
                  {showAuthors ? <span>by {row.post.author.name}</span> : null}
                </div>
                {row.post.title ? (
                  <h2 className="text-lg font-semibold text-text">{row.post.title}</h2>
                ) : null}
                <p className="line-clamp-3 text-sm whitespace-pre-line break-words text-text">
                  {documentToText(row.post.content)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {row.own ? (
                    <>
                      <Button
                        className="min-h-11"
                        disabled={publishing !== null}
                        aria-busy={publishing === row.post.id}
                        onClick={() => setConfirmingPublish(row)}
                      >
                        {publishing === row.post.id ? "Posting…" : "Post now"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => setEditing(row.post.id)}
                      >
                        Edit or reschedule
                      </Button>
                    </>
                  ) : null}
                  {row.canCancel ? (
                    <Button
                      variant="ghost"
                      className="min-h-11 text-danger"
                      onClick={() => setDeleting(row)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmingPublish !== null}
        onOpenChange={(open) => (open ? undefined : setConfirmingPublish(null))}
        title="Publish now?"
        description="Members see it in the feed right away."
        confirmLabel="Publish now"
        destructive={false}
        onConfirm={async () => {
          if (confirmingPublish) await publishNow(confirmingPublish);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this scheduled post?"
        description="It won't be published, and nobody is notified. This can't be undone."
        confirmLabel="Delete scheduled post"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await cancelScheduledPostAction({ slug, postId: deleting.post.id });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          setDeleting(null);
          toast.success("Scheduled post deleted.");
          router.refresh();
        }}
      />
    </>
  );
}
