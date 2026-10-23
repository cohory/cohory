import type { InstanceBranding } from "@cohory/config/platform";
import { CommunityMark } from "@cohory/ui";
import Link from "next/link";

export interface PlatformBrandCommunity {
  readonly slug: string;
  readonly name: string;
  readonly logoUrl: string | null;
}

const linkClassName =
  "flex min-h-11 min-w-0 items-center gap-2 rounded-sm font-semibold text-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function CohoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <circle
        cx="16"
        cy="16"
        r="7"
        fill="none"
        strokeWidth="3"
        className="stroke-accent-foreground"
      />
    </svg>
  );
}

export function PlatformBrand({
  community,
  instance,
}: {
  community: PlatformBrandCommunity | null;
  instance: InstanceBranding;
}) {
  if (community) {
    return (
      <Link href={`/c/${community.slug}`} className={`${linkClassName} text-base`}>
        <CommunityMark
          name={community.name}
          logoUrl={community.logoUrl}
          className="size-8 rounded-md text-sm"
        />
        <span className="truncate">{community.name}</span>
      </Link>
    );
  }
  return (
    <Link href="/" className={`${linkClassName} text-lg`}>
      {instance.logoUrl ? (
        <CommunityMark
          name={instance.name}
          logoUrl={instance.logoUrl}
          className="size-7 rounded-md border-0 object-contain"
        />
      ) : (
        <CohoryIcon className="size-7 shrink-0" />
      )}
      <span className="truncate">{instance.name}</span>
    </Link>
  );
}
