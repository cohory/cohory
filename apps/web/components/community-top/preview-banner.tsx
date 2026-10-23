import { Eye } from "lucide-react";
import Link from "next/link";

import type { PreviewGap } from "../../lib/communities/preview";

const linkClass =
  "inline-flex min-h-11 items-center rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function PreviewBanner({ slug, gaps }: { slug: string; gaps: readonly PreviewGap[] }) {
  return (
    <div role="status" className="border-b border-border bg-info-muted">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm text-text">
        <p className="inline-flex items-center gap-2">
          <Eye aria-hidden="true" className="size-4" strokeWidth={1.5} />
          <span>
            <span className="font-medium">Preview.</span> This is what people who are not members
            see.
          </span>
        </p>
        <Link href={`/c/${slug}/manage/appearance`} className={linkClass}>
          Back to Appearance
        </Link>
        {gaps.length > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-x-3">
            <p aria-hidden="true">Missing from this page:</p>
            <ul aria-label="Missing from this page" className="flex flex-wrap gap-x-3">
              {gaps.map((gap) => (
                <li key={gap.label}>
                  <Link href={gap.href} className={linkClass}>
                    {gap.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
