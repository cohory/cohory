"use client";

import { youtubePosterUrls } from "@cohory/content";
import { PlayIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../lib/utils";
import { PosterImage } from "./poster-image";
import {
  EMBED_PROVIDER_NAMES,
  resolveEmbed,
  safeImageSrc,
  safeLinkHref,
  type Block,
  type EmbedBlock,
  type ImageBlock,
  type Inline,
  type ParagraphBlock,
  type PostDocument,
} from "./content";

type PostContentVariant = "full" | "inline";

interface PostContentProps {
  document: PostDocument;
  variant?: PostContentVariant;
  className?: string;
  id?: string;
  headings?: boolean;
}

function ignoreUnknown(_value: never): null {
  return null;
}

function renderInline(node: Inline, index: number): ReactNode {
  switch (node.type) {
    case "mention":
      return (
        <span
          key={index}
          data-slot="mention"
          data-user-id={node.userId}
          className="rounded-sm bg-accent-muted px-1 font-medium text-text"
        >
          @{node.label}
        </span>
      );
    case "text": {
      const marks = node.marks ?? [];
      let content: ReactNode = node.text;
      if (marks.includes("italic")) content = <em>{content}</em>;
      if (marks.includes("bold")) content = <strong className="font-semibold">{content}</strong>;
      const href = marks.includes("link") ? safeLinkHref(node.href ?? node.text) : null;
      if (href) {
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener nofollow ugc"
            className="break-words text-accent underline underline-offset-2 hover:text-accent-hover focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {content}
          </a>
        );
      }
      return <span key={index}>{content}</span>;
    }
    default:
      return ignoreUnknown(node);
  }
}

function renderInlines(nodes: Inline[] | undefined): ReactNode {
  return Array.isArray(nodes) ? nodes.map(renderInline) : null;
}

const gridLayouts: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 [&>*:first-child]:col-span-2",
  4: "grid-cols-2",
};

function ImageGrid({ images }: { images: ImageBlock[] }) {
  const visible = images
    .map((image) => ({ image, src: safeImageSrc(image.url) }))
    .filter((entry): entry is { image: ImageBlock; src: string } => entry.src !== null)
    .slice(0, 10);
  if (visible.length === 0) return null;
  const count = visible.length;
  const layout = gridLayouts[count] ?? "grid-cols-2 sm:grid-cols-3";

  return (
    <div data-slot="image-grid" className={cn("grid gap-1 overflow-hidden rounded-md", layout)}>
      {visible.map(({ image, src }, index) => (
        <img
          key={image.key}
          src={src}
          alt={image.alt?.trim() || `Image ${index + 1} of ${count}`}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          className={cn(
            "w-full bg-surface-hover object-cover",
            count === 1 ? "max-h-128 object-contain" : "aspect-square",
          )}
        />
      ))}
    </div>
  );
}

function Embed({ block }: { block: EmbedBlock }) {
  const [loaded, setLoaded] = useState(false);
  const embed = resolveEmbed(block.url);
  if (!embed || embed.provider !== block.provider) return null;
  const name = EMBED_PROVIDER_NAMES[embed.provider];

  if (!loaded) {
    const posters = embed.provider === "youtube" ? youtubePosterUrls(embed.id) : [];
    return (
      <button
        type="button"
        data-slot="embed-placeholder"
        onClick={() => setLoaded(true)}
        className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-hover text-sm font-medium text-text transition-colors duration-(--duration-fast) hover:bg-accent-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        <PosterImage sources={posters} loading="lazy" />
        <span className="relative flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform duration-(--duration-fast) group-hover:scale-105 motion-reduce:transition-none">
          <PlayIcon className="size-6" aria-hidden="true" />
        </span>
        <span className="absolute bottom-2 left-2 rounded-md bg-surface px-2 py-1 text-xs text-text">
          Load {name} video
        </span>
      </button>
    );
  }

  return (
    <iframe
      src={embed.src}
      title={`${name} video`}
      className="aspect-video w-full rounded-md border-0"
      allow="fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      loading="lazy"
    />
  );
}

type Segment = { kind: "block"; block: Block } | { kind: "images"; images: ImageBlock[] };

function segment(blocks: Block[]): Segment[] {
  const segments: Segment[] = [];
  for (const block of blocks) {
    const last = segments.at(-1);
    if (block.type === "image") {
      if (last?.kind === "images") last.images.push(block);
      else segments.push({ kind: "images", images: [block] });
      continue;
    }
    segments.push({ kind: "block", block });
  }
  return segments;
}

const HEADING_PREFIX = /^## +(?=\S)/;

function headingContent(block: ParagraphBlock): Inline[] | null {
  const [first, ...rest] = Array.isArray(block.content) ? block.content : [];
  if (first?.type !== "text" || first.marks?.length || !HEADING_PREFIX.test(first.text)) {
    return null;
  }
  if (block.content.some((node) => node.type === "text" && node.text.includes("\n"))) {
    return null;
  }
  return [{ ...first, text: first.text.replace(HEADING_PREFIX, "") }, ...rest];
}

function renderBlock(
  block: Block,
  index: number,
  variant: PostContentVariant,
  headings: boolean,
): ReactNode {
  switch (block.type) {
    case "paragraph": {
      const heading = headings && variant === "full" ? headingContent(block) : null;
      if (heading) {
        return (
          <h3 key={index} className="pt-2 text-lg font-semibold text-text">
            {renderInlines(heading)}
          </h3>
        );
      }
      return (
        <p key={index} className="whitespace-pre-line break-words">
          {renderInlines(block.content)}
        </p>
      );
    }
    case "bulletList":
      if (variant === "inline" || !Array.isArray(block.items)) return null;
      return (
        <ul key={index} className="list-disc space-y-1 pl-6">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlines(item)}</li>
          ))}
        </ul>
      );
    case "embed":
      if (variant === "inline") return null;
      return <Embed key={index} block={block} />;
    case "image":
      return null;
    default:
      return ignoreUnknown(block);
  }
}

function PostContent({
  document,
  variant = "full",
  className,
  id,
  headings = false,
}: PostContentProps) {
  const blocks = Array.isArray(document.content) ? document.content : [];
  return (
    <div
      id={id}
      data-slot="post-content"
      className={cn("flex flex-col gap-3 text-base break-words text-text", className)}
    >
      {segment(blocks).map((entry, index) =>
        entry.kind === "images" ? (
          variant === "inline" ? null : (
            <ImageGrid key={index} images={entry.images} />
          )
        ) : (
          renderBlock(entry.block, index, variant, headings)
        ),
      )}
    </div>
  );
}

export { PostContent, type PostContentProps, type PostContentVariant };
