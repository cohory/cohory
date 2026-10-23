"use client";

import { cn } from "@cohory/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SettingsNavItem {
  readonly href: string;
  readonly label: string;
}

export function SettingsNav({ items }: { items: readonly SettingsNavItem[] }) {
  const pathname = usePathname();
  const root = items[0]?.href;

  return (
    <nav aria-label="Settings sections">
      <ul className="flex flex-wrap gap-1 border-b border-border pb-2">
        {items.map(({ href, label }) => {
          const active =
            href === root
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent-muted text-accent"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
