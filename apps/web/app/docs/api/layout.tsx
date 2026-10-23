import type { ReactNode } from "react";

import { PlatformBar } from "../../../components/platform-bar";

export default function ApiDocsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen bg-bg">
      <PlatformBar />
      <main id="content" className="mx-auto max-w-5xl px-4 py-8 md:py-10">
        {children}
      </main>
    </div>
  );
}
