"use client";

import { cn } from "@cohory/ui/lib/utils";
import {
  CalendarDays,
  GraduationCap,
  Info,
  Lock,
  MessagesSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  readonly label: string;
  readonly segment: "" | "about" | "classroom" | "calendar" | "members";
  readonly icon: LucideIcon;
  readonly locked?: boolean;
}

const memberTabs: readonly Tab[] = [
  { label: "Community", segment: "", icon: MessagesSquare },
  { label: "Classroom", segment: "classroom", icon: GraduationCap },
  { label: "Calendar", segment: "calendar", icon: CalendarDays },
  { label: "Members", segment: "members", icon: Users },
];

const visitorTabs: readonly Tab[] = [
  { label: "About", segment: "about", icon: Info },
  { label: "Community", segment: "", icon: MessagesSquare },
  { label: "Classroom", segment: "classroom", icon: GraduationCap, locked: true },
  { label: "Calendar", segment: "calendar", icon: CalendarDays },
  { label: "Members", segment: "members", icon: Users, locked: true },
];

export type CommunityTabsAudience = "member" | "visitor";

function tabHref(base: string, segment: Tab["segment"], audience: CommunityTabsAudience): string {
  if (segment) return `${base}/${segment}`;
  return audience === "visitor" ? `${base}/feed` : base;
}

const otherSegments = new Set(["classroom", "calendar", "members", "manage", "about"]);

function isActive(pathname: string, base: string, segment: Tab["segment"]): boolean {
  if (!pathname.startsWith(base)) {
    return false;
  }
  const first = pathname.slice(base.length).split("/").filter(Boolean)[0] ?? "";
  if (segment === "") {
    return !otherSegments.has(first);
  }
  return first === segment;
}

function LockMark() {
  return (
    <>
      <Lock aria-hidden="true" className="size-3.5 text-text-muted" strokeWidth={2} />
      <span className="sr-only">, for members</span>
    </>
  );
}

export function CommunityTabs({
  slug,
  audience = "member",
}: {
  slug: string;
  audience?: CommunityTabsAudience;
}) {
  const pathname = usePathname();
  const base = `/c/${slug}`;
  const tabs = audience === "visitor" ? visitorTabs : memberTabs;
  const items = tabs.map((tab) => ({
    ...tab,
    href: tabHref(base, tab.segment, audience),
    active: isActive(pathname, base, tab.segment),
  }));

  return (
    <>
      <nav aria-label="Community sections" className="hidden border-b border-border md:block">
        <ul className="mx-auto flex max-w-5xl gap-1 px-4">
          {items.map(({ label, href, active, locked, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-text-muted hover:text-text",
                )}
              >
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.5} />
                {label}
                {locked ? <LockMark /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label="Community sections"
        className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className={cn("grid h-16", items.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
          {items.map(({ label, href, active, locked, icon: Icon }) => (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-accent" : "text-text-muted",
                )}
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" strokeWidth={1.5} />
                  {locked ? (
                    <Lock
                      aria-hidden="true"
                      className="absolute -top-1 -right-2 size-3.5 rounded-full bg-surface"
                      strokeWidth={2}
                    />
                  ) : null}
                </span>
                {label}
                {locked ? <span className="sr-only">, for members</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
