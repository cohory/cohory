import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import { Toaster } from "@cohory/ui/primitives/toast";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { InstanceBrandingProvider } from "../components/instance-branding";
import { AppLinkProvider } from "../components/link-provider";
import { SupportLinksProvider } from "../components/support-links";
import { fontVariableClassName } from "../lib/theme/fonts";
import { themeScript } from "../lib/theme/theme-script";
import "./globals.css";

const description = "The open-source community platform for creators.";

export function generateMetadata(): Metadata {
  const { appUrl, instance } = getPlatformConfig();
  return {
    metadataBase: new URL(appUrl),
    title: { default: instance.name, template: `%s · ${instance.name}` },
    description,
    applicationName: instance.name,
    openGraph: { type: "website", siteName: instance.name, title: instance.name, description },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    /* eslint-disable no-restricted-syntax -- the theme-color meta tag needs literal colors; these are --color-bg from tokens.css */
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0E131B" },
    /* eslint-enable no-restricted-syntax */
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const legal = legalLinks(getLegalConfig(), getPlatformConfig().edition);
  return (
    <html lang="en" className={fontVariableClassName} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <a
          href="#content"
          className="sr-only rounded-md bg-surface px-4 py-3 text-sm font-medium text-text shadow-md outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-tooltip) focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <InstanceBrandingProvider instance={getPlatformConfig().instance}>
          <SupportLinksProvider links={{ contact: legal.contact, status: legal.status }}>
            <AppLinkProvider>{children}</AppLinkProvider>
          </SupportLinksProvider>
        </InstanceBrandingProvider>
        <Toaster />
      </body>
    </html>
  );
}
