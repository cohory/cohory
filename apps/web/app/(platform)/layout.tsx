import type { ReactNode } from "react";

import { LegalFooter } from "../../components/legal-footer";
import { PlatformBar } from "../../components/platform-bar";

export default function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <PlatformBar />
      <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}
