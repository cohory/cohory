"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function OutsideMembershipPage({ slug, children }: { slug: string; children: ReactNode }) {
  return usePathname() === `/c/${slug}/membership` ? null : children;
}
