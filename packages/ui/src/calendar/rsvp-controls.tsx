"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "../primitives/button";
import { cn } from "../lib/utils";
import type { RsvpStatus } from "./types";

interface RsvpControlsProps {
  status: RsvpStatus | null;
  onRsvp(status: RsvpStatus): void;
  pending?: boolean;
  emphasis?: "primary" | "secondary";
  eventTitle?: string;
  size?: "sm" | "md";
  className?: string;
}

function RsvpControls({
  status,
  onRsvp,
  pending = false,
  emphasis = "primary",
  eventTitle,
  size = "sm",
  className,
}: RsvpControlsProps) {
  const going = status === "going";
  const suffix = eventTitle ? ` to ${eventTitle}` : "";

  return (
    <div
      role="group"
      aria-label={`RSVP${suffix}`}
      aria-busy={pending || undefined}
      data-slot="rsvp-controls"
      className={cn("relative flex flex-wrap items-center gap-2", className)}
    >
      <Button
        type="button"
        size={size}
        variant={going ? "secondary" : emphasis}
        aria-pressed={going}
        disabled={pending}
        onClick={() => {
          if (!going) onRsvp("going");
        }}
        className={cn(going && "border-accent bg-accent-muted text-text hover:bg-accent-muted")}
      >
        {going ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
        Going
      </Button>
      <Button
        type="button"
        size={size}
        variant="ghost"
        aria-pressed={status === "not_going"}
        disabled={pending}
        onClick={() => {
          if (status !== "not_going") onRsvp("not_going");
        }}
        className={cn(status === "not_going" && "bg-surface-hover")}
      >
        {going ? "Can't go" : "Not going"}
      </Button>
    </div>
  );
}

export { RsvpControls, type RsvpControlsProps };
