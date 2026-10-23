import { BotIcon } from "lucide-react";

import { cn } from "../lib/utils";

export function AgentAvatar({ className }: { className?: string }) {
  return (
    <span
      data-slot="agent-avatar"
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-muted",
        className,
      )}
    >
      <BotIcon className="size-4" />
    </span>
  );
}
