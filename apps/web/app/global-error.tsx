"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ErrorPanel } from "../components/error-panel";
import { fontVariableClassName } from "../lib/theme/fonts";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, []);

  return (
    <html lang="en" className={fontVariableClassName}>
      <body className="min-h-screen bg-bg">
        <title>Something went wrong</title>
        <main id="content" className="mx-auto max-w-5xl px-4 py-12">
          <ErrorPanel error={error} retry={retry} />
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-link">
              Go to home
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
