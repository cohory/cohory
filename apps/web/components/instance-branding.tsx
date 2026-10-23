"use client";

import type { InstanceBranding } from "@cohory/config/platform";
import { createContext, use, type ReactNode } from "react";

const InstanceBrandingContext = createContext<InstanceBranding | null>(null);

export function InstanceBrandingProvider({
  instance,
  children,
}: {
  instance: InstanceBranding;
  children: ReactNode;
}) {
  return <InstanceBrandingContext value={instance}>{children}</InstanceBrandingContext>;
}

export function useInstanceBranding(): InstanceBranding | null {
  return use(InstanceBrandingContext);
}
