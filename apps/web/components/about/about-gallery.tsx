"use client";

import type { GalleryItemView } from "@cohory/communities";
import { videoPlayerUrl, videoPosterUrls } from "@cohory/content";
import { imageSrcSetFromUrl } from "@cohory/storage/variants";
import { Dialog, DialogContent, DialogTitle, PosterImage } from "@cohory/ui";
import { cn } from "@cohory/ui/lib/utils";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type TouchEvent } from "react";

import { providerNames, VideoPoster } from "./video-poster";
import { StoredImage } from "../stored-image";

type VideoItem = Extract<GalleryItemView, { kind: "video_embed" }>;
type ImageItem = Extract<GalleryItemView, { kind: "image" }>;

const swipeMinDistance = 40;

function itemLabel(item: GalleryItemView, index: number, count: number): string {
  const kind = item.kind === "image" ? "Image" : `${providerNames[item.provider]} video`;
  const position = `${kind} ${index + 1} of ${count}`;
  return item.altText ? `${position}: ${item.altText}` : position;
}

function VideoPlayer({ item }: { item: VideoItem }) {
  const src = videoPlayerUrl(item.url, "on-click");
  if (!src) {
    return null;
  }
  return (
    <iframe
      data-slot="gallery-player"
      src={src}
      title={item.altText ?? `${providerNames[item.provider]} video`}
      className="aspect-video w-full rounded-(--card-radius) border-0 bg-surface-hover shadow-(--card-shadow)"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
    />
  );
}

function VideoHero({ item }: { item: VideoItem }) {
  const [clicked, setClicked] = useState(false);
  if (clicked) {
    return <VideoPlayer item={item} />;
  }
  const name = providerNames[item.provider];
  return (
    <button
      type="button"
      data-slot="gallery-poster"
      aria-label={`Play ${name} video${item.altText ? `: ${item.altText}` : ""}`}
      onClick={() => setClicked(true)}
      className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-(--card-radius) border border-border bg-surface-hover shadow-(--card-shadow) text-sm font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PosterImage sources={videoPosterUrls(item.url, item.thumbnailUrl)} />
      <span className="relative flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform duration-(--duration-fast) group-hover:scale-105 motion-reduce:transition-none">
        <Play aria-hidden="true" className="size-6" strokeWidth={1.5} />
      </span>
      <span className="absolute bottom-3 left-3 rounded-md bg-surface px-2 py-1 text-xs text-text">
        Play {name} video
      </span>
    </button>
  );
}

function ImageHero({ item }: { item: ImageItem }) {
  const [open, setOpen] = useState(false);
  const label = item.altText ?? "Gallery image";
  return (
    <>
      <button
        type="button"
        aria-label={`Open full screen: ${label}`}
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in rounded-(--card-radius) outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <StoredImage
          src={item.url}
          srcSet={imageSrcSetFromUrl(item.url) ?? undefined}
          sizes="(min-width: 1024px) 640px, 100vw"
          alt={item.altText ?? ""}
          decoding="async"
          className="aspect-video w-full rounded-(--card-radius) border border-border bg-surface-hover object-cover shadow-(--card-shadow)"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,1600px)] p-2 sm:p-3">
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <StoredImage
            src={item.url}
            alt={item.altText ?? ""}
            decoding="async"
            className="max-h-[85vh] w-full rounded-md object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

const stepButton =
  "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-(--card-shadow) outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring";

export function AboutGallery({ items }: { items: readonly GalleryItemView[] }) {
  const [selected, setSelected] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([]);
  const count = items.length;
  const index = Math.min(selected, count - 1);
  const current = items[index];
  if (!current) {
    return null;
  }
  const go = (target: number) => setSelected((target + count) % count);

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch || count < 2) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < swipeMinDistance || Math.abs(dx) < Math.abs(dy)) return;
    go(dx < 0 ? index + 1 : index - 1);
  };
  const onThumbnailKey = (event: KeyboardEvent) => {
    const targets: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: count - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + count) % count;
    setSelected(next);
    thumbnails.current[next]?.focus();
  };

  return (
    <section aria-label="Gallery" className="flex flex-col gap-3">
      <div
        data-slot="gallery-hero"
        className="relative touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {current.kind === "image" ? (
          <ImageHero key={current.id} item={current} />
        ) : (
          <VideoHero key={current.id} item={current} />
        )}
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous item"
              onClick={() => go(index - 1)}
              className={cn(stepButton, "left-2")}
            >
              <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Next item"
              onClick={() => go(index + 1)}
              className={cn(stepButton, "right-2")}
            >
              <ChevronRight aria-hidden="true" className="size-5" strokeWidth={1.5} />
            </button>
            <span
              aria-hidden="true"
              className="absolute top-3 right-3 rounded-md bg-surface px-2 py-1 text-xs font-medium text-text tabular-nums"
            >
              {index + 1} / {count}
            </span>
            <span role="status" aria-live="polite" className="sr-only">
              {itemLabel(current, index, count)}
            </span>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <ul aria-label="Gallery items" className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap">
          {items.map((item, position) => (
            <li key={item.id} className="shrink-0">
              <button
                ref={(element) => {
                  thumbnails.current[position] = element;
                }}
                type="button"
                aria-label={itemLabel(item, position, count)}
                aria-pressed={position === index}
                tabIndex={position === index ? 0 : -1}
                onClick={() => setSelected(position)}
                onKeyDown={onThumbnailKey}
                className={cn(
                  "block h-14 w-24 overflow-hidden rounded-md border-2 bg-surface-hover outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  position === index ? "border-accent" : "border-transparent",
                )}
              >
                {item.kind === "image" ? (
                  <StoredImage
                    src={item.url}
                    srcSet={imageSrcSetFromUrl(item.url) ?? undefined}
                    sizes="96px"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <VideoPoster item={item} />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
