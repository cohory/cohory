"use client";

import type { GalleryItemView } from "@cohory/communities";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@cohory/ui";
import { ImageUp } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import {
  addGalleryImageAction,
  addGalleryVideoAction,
  removeGalleryItemAction,
  reorderGalleryAction,
  updateGalleryAltTextAction,
} from "../../lib/manage/about-actions";
import type { ActionResult } from "../../lib/posts/errors";
import { ConfirmDialog } from "../feed/confirm-dialog";
import { providerNames } from "../about/video-poster";
import { GalleryRow } from "./gallery-row";

const maxItems = 10;
const uploadLimit = 10 * 1024 * 1024;

function describe(item: GalleryItemView, index: number): string {
  const kind = item.kind === "image" ? "Image" : `${providerNames[item.provider]} video`;
  return `${kind} ${index + 1}`;
}

function moved(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  if (id !== undefined) next.splice(to, 0, id);
  return next;
}

function AddBar({
  count,
  pending,
  onImage,
  onVideo,
  onEmpty,
}: {
  count: number;
  pending: boolean;
  onImage(file: File | undefined): void;
  onVideo(url: string): Promise<boolean>;
  onEmpty(): void;
}) {
  const [videoUrl, setVideoUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const full = count >= maxItems;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Gallery image"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          onImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={pending || full}
        onClick={() => fileInput.current?.click()}
      >
        <ImageUp aria-hidden="true" className="size-5" strokeWidth={1.5} />
        Upload image
      </Button>
      <form
        className="flex min-w-0 flex-1 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (videoUrl.trim() === "") {
            onEmpty();
            return;
          }
          void onVideo(videoUrl).then((added) => {
            if (added) setVideoUrl("");
          });
        }}
      >
        <label htmlFor={`${id}-video`} className="sr-only">
          Video link
        </label>
        <div className="flex min-w-0">
          <Input
            id={`${id}-video`}
            type="url"
            inputMode="url"
            placeholder="Paste a video link"
            aria-describedby={`${id}-help`}
            value={videoUrl}
            maxLength={2048}
            disabled={pending || full}
            onChange={(event) => setVideoUrl(event.target.value)}
            className="min-h-11 rounded-r-none"
          />
          <Button
            type="submit"
            variant="secondary"
            aria-label="Add video"
            className="-ml-px min-h-11 rounded-l-none"
            disabled={pending || full}
          >
            Add
          </Button>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-sm text-text-muted">
          <p id={`${id}-help`}>
            {full
              ? "The gallery is full. Remove an item to add another."
              : "A YouTube, Vimeo, or Loom link."}
          </p>
          <p className="shrink-0 tabular-nums">
            {count} of {maxItems}
            <span className="sr-only"> items used</span>
          </p>
        </div>
      </form>
    </div>
  );
}

export function GalleryManager({
  slug,
  initial,
}: {
  slug: string;
  initial: readonly GalleryItemView[];
}) {
  const [items, setItems] = useState<readonly GalleryItemView[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const dragged = useRef<number | null>(null);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (!id || pending) return;
    refocus.current = null;
    document.querySelector<HTMLElement>(`[data-gallery-actions="${id}"]`)?.focus();
  }, [items, pending]);

  function run(task: () => Promise<ActionResult<GalleryItemView[]>>, done: string) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await task();
        if (!result.ok) {
          setError(result.message);
          resolve(false);
          return;
        }
        setError(null);
        setItems(result.data);
        setStatus(done);
        resolve(true);
      });
    });
  }

  function chooseImage(file: File | undefined) {
    if (!file) return;
    if (file.size > uploadLimit) {
      setError("That image is too large. Choose one under 10 MB.");
      return;
    }
    const data = new FormData();
    data.set("file", file);
    void run(() => addGalleryImageAction(slug, data), "Image added.");
  }

  function move(from: number, to: number) {
    const item = items[from];
    if (!item || to < 0 || to >= items.length || from === to) return;
    const ids = moved(
      items.map((entry) => entry.id),
      from,
      to,
    );
    refocus.current = item.id;
    void run(
      () => reorderGalleryAction(slug, ids),
      to === 0
        ? `${describe(item, from)} is now the hero.`
        : `${describe(item, from)} moved to position ${to + 1}.`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Gallery</CardTitle>
        <CardDescription>
          Up to {maxItems} images and videos at the top of your About page. The first one is the
          hero. Drag items, or use each item&apos;s actions menu, to change the order.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AddBar
          count={items.length}
          pending={pending}
          onImage={chooseImage}
          onVideo={(url) => run(() => addGalleryVideoAction(slug, { url }), "Video added.")}
          onEmpty={() => setError("Paste a YouTube, Vimeo, or Loom video link.")}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {items.length > 0 ? (
          <ol aria-label="Gallery items" className="flex flex-col gap-2">
            {items.map((item, index) => (
              <GalleryRow
                key={item.id}
                item={item}
                label={describe(item, index)}
                index={index}
                count={items.length}
                pending={pending}
                onMove={(to) => move(index, to)}
                onRemove={() => setRemoving({ id: item.id, label: describe(item, index) })}
                onAltText={(text) =>
                  void run(
                    () => updateGalleryAltTextAction(slug, { itemId: item.id, altText: text }),
                    "Alt text saved.",
                  )
                }
                onDragStart={() => {
                  dragged.current = index;
                }}
                onDrop={() => {
                  if (dragged.current !== null) move(dragged.current, index);
                  dragged.current = null;
                }}
              />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-text-muted">No images or videos yet.</p>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          title={`Remove ${removing?.label ?? "this item"}?`}
          description="It disappears from your About page. You can add it again later."
          confirmLabel={`Remove ${removing?.label ?? "item"}`}
          onConfirm={async () => {
            if (!removing) return;
            const { id, label } = removing;
            await run(() => removeGalleryItemAction(slug, id), `${label} removed.`);
            setRemoving(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
