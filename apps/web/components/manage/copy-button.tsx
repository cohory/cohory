"use client";

import { Button, toast } from "@cohory/ui";
import { Copy } from "lucide-react";

export function CopyButton({
  value,
  label = "Copy link",
  copiedMessage = "Link copied.",
  onCopied,
}: {
  value: string;
  label?: string;
  copiedMessage?: string;
  onCopied?: () => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(copiedMessage);
    } catch {
      toast.error("We couldn't copy that. Select it and copy it yourself.");
      return;
    }
    onCopied?.();
  }

  return (
    <Button type="button" variant="secondary" onClick={copy} className="min-h-11">
      <Copy aria-hidden="true" className="size-4" strokeWidth={1.5} />
      {label}
    </Button>
  );
}
