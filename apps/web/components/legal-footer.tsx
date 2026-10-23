import { getLegalConfig, legalLinks, type LegalLinks } from "@cohory/config/legal";
import { getPlatformConfig, type Edition } from "@cohory/config/platform";
import { cn } from "@cohory/ui";
import Link from "next/link";

import {
  loadCreatorsCommunityLink,
  type CreatorsCommunityLink,
} from "../lib/communities/creators-community";
import packageJson from "../package.json";

interface FooterLink {
  readonly label: string;
  readonly href: string;
}

export function footerLinks(
  links: LegalLinks,
  creators: CreatorsCommunityLink | null = null,
): FooterLink[] {
  const entries: [string, string | null][] = [
    ...(creators ? [[creators.label, creators.href] satisfies [string, string]] : []),
    ["Terms", links.terms],
    ["Privacy", links.privacy],
    ["Community Guidelines", links.guidelines],
    ["Imprint", links.imprint],
    ["Contact", links.contact],
    ["Report content", links.report],
    ["Security", links.security],
    ["Status", links.status],
    ["Source code", links.source],
  ];
  return entries.flatMap(([label, href]) => (href ? [{ label, href }] : []));
}

export function productLine(edition: Edition): string {
  return edition === "cloud"
    ? `Cohory ${packageJson.version}`
    : `Powered by Cohory ${packageJson.version}`;
}

const linkClass =
  "rounded-sm underline-offset-4 outline-none hover:text-text hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export async function LegalFooter({ className }: { className?: string }) {
  const { edition } = getPlatformConfig();
  const links = footerLinks(
    legalLinks(getLegalConfig(), edition),
    await loadCreatorsCommunityLink(),
  );
  return (
    <footer className={cn("border-t border-border text-sm text-text-muted", className)}>
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 md:flex-row md:items-center md:justify-between">
        <nav aria-label="Legal and support">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {links.map((link) => (
              <li key={link.label}>
                {link.href.startsWith("/") && !link.href.startsWith("/.well-known") ? (
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                ) : (
                  <a href={link.href} className={linkClass}>
                    {link.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p>{productLine(edition)}</p>
      </div>
    </footer>
  );
}
