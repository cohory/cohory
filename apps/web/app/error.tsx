"use client";

import { ErrorPanel } from "../components/error-panel";
import { useInstanceBranding } from "../components/instance-branding";
import { PlatformBrand } from "../components/platform-brand";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const instance = useInstanceBranding();
  return (
    <div className="min-h-screen bg-bg">
      {instance ? (
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
            <PlatformBrand community={null} instance={instance} />
          </div>
        </header>
      ) : null}
      <main id="content" className="mx-auto max-w-5xl px-4 py-12">
        <ErrorPanel error={error} retry={retry} />
      </main>
    </div>
  );
}
