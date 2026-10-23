"use client";

import { cn } from "@cohory/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const developerSections = [
  { label: "API tokens", href: "/account/api-tokens" },
  { label: "Agents", href: "/account/agents" },
  { label: "Connected apps", href: "/account/connected-apps" },
] as const;

const memberSections = [
  { label: "Profile", href: "/account" },
  { label: "Notifications", href: "/account/notifications" },
  { label: "Security", href: "/account/security" },
  { label: "Billing", href: "/account/billing" },
] as const;

export function isDeveloperPath(path: string): boolean {
  return developerSections.some(({ href }) => path === href || path.startsWith(`${href}/`));
}

function tabClass(active: boolean): string {
  return cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
  );
}

export function AccountNav() {
  const pathname = usePathname();
  const developer = isDeveloperPath(pathname);

  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Account sections" className="border-b border-border">
        <ul className="flex gap-1 overflow-x-auto">
          {memberSections.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={tabClass(pathname === href)}
              >
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link href={developerSections[0].href} className={tabClass(developer)}>
              Developers
            </Link>
          </li>
        </ul>
      </nav>
      {developer ? (
        <nav aria-label="Developer sections">
          <ul className="flex flex-wrap gap-1">
            {developerSections.map(({ label, href }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    pathname === href
                      ? "bg-surface-hover text-text"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
