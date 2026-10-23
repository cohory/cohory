"use client";

import { useState } from "react";

import { cn } from "../lib/utils";

const placeholderMaxWidth = 120;

interface PosterImageProps {
  sources: readonly string[];
  className?: string;
  loading?: "eager" | "lazy";
}

function PosterImage({ sources, className, loading }: PosterImageProps) {
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (!src) return null;
  const next = () => setIndex((current) => current + 1);
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading={loading}
      decoding="async"
      onError={next}
      onLoad={(event) => {
        // YouTube answers a missing maxresdefault with a 120 pixel wide grey image.
        if (event.currentTarget.naturalWidth <= placeholderMaxWidth && index < sources.length - 1) {
          next();
        }
      }}
      className={cn("absolute inset-0 size-full object-cover", className)}
    />
  );
}

export { PosterImage, type PosterImageProps };
