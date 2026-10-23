import { getPlatformConfig } from "@cohory/config/platform";
import { Button } from "@cohory/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { withNext } from "../../lib/auth/form-links";
import { myCommunitiesHref } from "../../lib/communities/home-destination";
import { earlyAccessHref, getEarlyAccessService } from "../../lib/early-access/service";
import { creatorCta, type CreatorCta } from "../../lib/marketing/creator-cta";
import { currentSession } from "../../lib/session";
import { LegalFooter } from "../legal-footer";
import { PlatformBrand } from "../platform-brand";

export const createCommunityHref = withNext("/sign-up", "/communities/new");

export const selfHostHref = "/open-source";

export function currentCreatorCta(): CreatorCta {
  const { signUpMode, communityCreation } = getPlatformConfig();
  return creatorCta({
    signUpMode,
    communityCreation,
    earlyAccess: getEarlyAccessService().available,
  });
}

const headerCtas: Partial<Record<CreatorCta, { href: string; label: string }>> = {
  create: { href: createCommunityHref, label: "Create your community" },
  "early-access": { href: earlyAccessHref, label: "Request early access" },
};

const navLinkClass =
  "inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-medium text-text-muted underline-offset-4 outline-none hover:text-text hover:underline focus-visible:ring-2 focus-visible:ring-ring";

async function MarketingHeader() {
  const session = await currentSession();
  const { instance } = getPlatformConfig();
  const cta = headerCtas[currentCreatorCta()];
  return (
    <header className="border-b border-border bg-surface md:sticky md:top-0 md:z-(--z-header)">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 px-4 py-1 md:h-14 md:flex-nowrap md:py-0">
        <div className="flex min-w-0 items-center">
          <PlatformBrand community={null} instance={instance} />
        </div>
        <nav
          aria-label="Main"
          className="order-last -ml-2 flex w-full items-center gap-1 md:order-none md:mr-auto md:ml-4 md:w-auto"
        >
          <Link href="/pricing" className={navLinkClass}>
            Pricing
          </Link>
          <Link href="/open-source" className={navLinkClass}>
            Open source
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {session ? (
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={myCommunitiesHref}>My communities</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="secondary" className="min-h-11">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              {cta ? (
                <Button asChild className="hidden min-h-11 sm:inline-flex">
                  <Link href={cta.href}>{cta.label}</Link>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <MarketingHeader />
      <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-16">
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

export function SignUpCta({
  className,
  selfHost = true,
}: {
  className?: string;
  selfHost?: boolean;
}) {
  const cta = currentCreatorCta();
  if (cta === "sign-in") {
    return (
      <div className={className}>
        <Button asChild size="lg">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }
  if (cta === "create") {
    return (
      <div className={className}>
        <Button asChild size="lg">
          <Link href={createCommunityHref}>Create your community</Link>
        </Button>
        <p className="mt-2 text-sm text-text-muted">No credit card required.</p>
      </div>
    );
  }
  if (cta === "self-host" && !selfHost) {
    return null;
  }
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-3">
        {cta === "early-access" ? (
          <Button asChild size="lg">
            <Link href={earlyAccessHref}>Request early access</Link>
          </Button>
        ) : null}
        {selfHost ? (
          <Button asChild size="lg" variant={cta === "early-access" ? "secondary" : "primary"}>
            <Link href={selfHostHref}>Self-host now</Link>
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-text-muted">
        Cloud is open to a small group of creators for now.
      </p>
    </div>
  );
}
