"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { previewParam } from "../../lib/communities/preview";

export function CommunityTop({
  slug,
  preview,
  children,
}: {
  slug: string;
  preview: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewing =
    preview !== null && pathname === `/c/${slug}/about` && searchParams.get(previewParam) === "1";
  return previewing ? preview : children;
}
