"use client";

import { createContext, use, type ReactNode } from "react";

export interface SupportLinks {
  readonly contact: string | null;
  readonly status: string | null;
}

const SupportLinksContext = createContext<SupportLinks | null>(null);

export function SupportLinksProvider({
  links,
  children,
}: {
  links: SupportLinks;
  children: ReactNode;
}) {
  return <SupportLinksContext value={links}>{children}</SupportLinksContext>;
}

export function useSupportLinks(): SupportLinks {
  return use(SupportLinksContext) ?? { contact: null, status: null };
}
