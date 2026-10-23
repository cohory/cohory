"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import { RelativeTime } from "./relative-time";

interface DeletionInfo {
  byName: string | null;
  at: string | Date;
}

interface DeletedNoticeProps {
  noun: "post" | "comment";
  deletion: DeletionInfo;
  now?: Date;
  className?: string;
  children: ReactNode;
}

function DeletedNotice({ noun, deletion, now, className, children }: DeletedNoticeProps) {
  const [revealed, setRevealed] = useState(false);
  const contentId = useId();
  const Icon = revealed ? EyeOffIcon : EyeIcon;

  return (
    <div data-slot="deleted-notice" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          Deleted by {deletion.byName ?? "a removed account"}{" "}
          <RelativeTime value={deletion.at} now={now} />
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={revealed}
          aria-controls={contentId}
          onClick={() => setRevealed((value) => !value)}
          className="min-h-11 text-text-muted"
        >
          <Icon className="size-4" aria-hidden="true" />
          {revealed ? `Hide deleted ${noun}` : `Show deleted ${noun}`}
        </Button>
      </div>
      <div id={contentId} hidden={!revealed} className="flex flex-col gap-3 opacity-80">
        {revealed ? children : null}
      </div>
    </div>
  );
}

export { DeletedNotice, type DeletedNoticeProps, type DeletionInfo };
