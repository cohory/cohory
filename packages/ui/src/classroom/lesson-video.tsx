"use client";

import { PlayIcon, VideoOffIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/utils";
import { resolveLessonVideo, type LessonVideoProvider } from "./types";

interface LessonVideoProps {
  url: string;
  provider?: LessonVideoProvider | null;
  title: string;
  className?: string;
}

function LessonVideo({ url, provider, title, className }: LessonVideoProps) {
  const [loaded, setLoaded] = useState(false);
  const video = resolveLessonVideo(url, provider);

  if (!video) {
    return (
      <div
        role="alert"
        data-slot="lesson-video-error"
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-hover p-4 text-center text-sm text-text-muted",
          className,
        )}
      >
        <VideoOffIcon className="size-8 text-text-subtle" aria-hidden="true" />
        <span>This video couldn&apos;t load. Ask the creator to check the link.</span>
      </div>
    );
  }

  if (!loaded) {
    return (
      <button
        type="button"
        data-slot="lesson-video-placeholder"
        onClick={() => setLoaded(true)}
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-hover text-sm font-medium text-text transition-colors duration-(--duration-fast) outline-none hover:bg-accent-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none",
          className,
        )}
      >
        <PlayIcon className="size-10 text-accent" aria-hidden="true" />
        <span>Play {video.name} video</span>
      </button>
    );
  }

  return (
    <iframe
      src={`${video.src}${video.src.includes("?") ? "&" : "?"}autoplay=1`}
      title={`${title} (${video.name} video)`}
      data-slot="lesson-video"
      className={cn("aspect-video w-full rounded-lg border-0 bg-surface-hover", className)}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
    />
  );
}

export { LessonVideo, type LessonVideoProps };
