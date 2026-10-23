import { getPlatformConfig } from "@cohory/config/platform";
import type { ReactNode } from "react";

import { LegalFooter } from "../../components/legal-footer";
import { PlatformBrand } from "../../components/platform-brand";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <header className="flex w-full max-w-sm justify-center">
          <PlatformBrand community={null} instance={getPlatformConfig().instance} />
        </header>
        <main id="content" className="w-full max-w-sm">
          {children}
        </main>
      </div>
      <LegalFooter />
    </div>
  );
}
