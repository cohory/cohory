"use client";

import { cn } from "@cohory/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  manageSectionHref,
  manageSectionLabels,
  type ManageSection,
} from "../../lib/manage/sections";

export function ManageNav({
  slug,
  sections,
  hints = {},
  counts = {},
}: {
  slug: string;
  sections: readonly ManageSection[];
  hints?: Partial<Record<ManageSection, string>>;
  counts?: Partial<Record<ManageSection, number>>;
}) {
  const pathname = usePathname();
  const items = sections.map((section) => {
    const href = manageSectionHref(slug, section);
    const active =
      section === "overview"
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`);
    return { section, href, active, label: manageSectionLabels[section], hint: hints[section] };
  });

  return (
    <nav aria-label="Manage sections" className="md:w-48 md:shrink-0">
      <ul className="grid grid-cols-3 gap-1 md:flex md:flex-col">
        {items.map(({ section, href, active, label, hint }) => {
          const count = counts[section] ?? 0;
          return (
            <li key={section}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-describedby={hint ? `manage-hint-${section}` : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent-muted text-accent"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {label}
                {count > 0 ? (
                  <span className="rounded-full bg-accent px-2 text-xs leading-5 text-accent-foreground tabular-nums">
                    <span className="sr-only">, </span>
                    {count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
              {hint ? (
                <p
                  id={`manage-hint-${section}`}
                  className="hidden px-3 text-xs text-text-muted md:block"
                >
                  {hint}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
