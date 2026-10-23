"use client";

import { LinkProvider } from "@cohory/ui/lib/link";
import NextLink from "next/link";
import type { ReactNode } from "react";

export function AppLinkProvider({ children }: { children: ReactNode }) {
  return <LinkProvider component={NextLink}>{children}</LinkProvider>;
}
