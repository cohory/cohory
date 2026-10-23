"use client";

import { Button } from "@cohory/ui";
import { CircleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { feedbackHref, sendFeedbackLabel } from "../lib/contact/feedback";
import { EmptyState } from "./empty-state";
import { useSupportLinks } from "./support-links";

type CopyState = "idle" | "copied" | "failed";

const copyMessages: Record<CopyState, string> = {
  idle: "",
  copied: "Error details copied.",
  failed: "Couldn't copy. Select the error ID above instead.",
};

function digestOf(error: unknown): string | null {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") {
    return error.digest;
  }
  return null;
}

export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const digest = digestOf(error);
  const support = useSupportLinks();
  const pathname = usePathname();

  async function copyDetails() {
    const details = [
      digest ? `Error ID: ${digest}` : null,
      `Page: ${location.href}`,
      `Time: ${new Date().toISOString()}`,
    ]
      .filter((line) => line !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <EmptyState
      icon={CircleAlert}
      title="Something went wrong on our side"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={retry} className="min-h-11">
            Try again
          </Button>
          <Button variant="secondary" onClick={copyDetails} className="min-h-11">
            Copy error details
          </Button>
        </div>
      }
    >
      <p>Try again. If it keeps happening, copy the error details and send them to support.</p>
      {digest ? <p className="mt-2 font-mono text-xs select-all">Error ID: {digest}</p> : null}
      {support.contact || support.status ? (
        <p className="mt-2 flex flex-wrap justify-center gap-x-4">
          {support.contact ? (
            <>
              <a href={support.contact} className="text-link">
                Contact support
              </a>
              <a href={feedbackHref(pathname ?? "/")} className="text-link">
                {sendFeedbackLabel}
              </a>
            </>
          ) : null}
          {support.status ? (
            <a href={support.status} className="text-link">
              Service status
            </a>
          ) : null}
        </p>
      ) : null}
      <p role="status" className="mt-2 empty:hidden">
        {copyMessages[copy]}
      </p>
    </EmptyState>
  );
}
