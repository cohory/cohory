import { getPlatformConfig } from "@cohory/config/platform";
import Link from "next/link";

import { LegalFooter } from "../components/legal-footer";
import { CommunityNotFound } from "../components/not-found-panel";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
          <Link
            href="/"
            className="rounded-sm text-lg font-semibold text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {getPlatformConfig().instance.name}
          </Link>
        </div>
      </header>
      <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <CommunityNotFound />
      </main>
      <LegalFooter />
    </div>
  );
}
