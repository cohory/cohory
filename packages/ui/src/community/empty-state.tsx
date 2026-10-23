import type { ReactNode } from "react";

import { cn } from "../lib/utils";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center", className)}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-1 flex size-10 items-center justify-center rounded-full bg-accent-muted text-accent [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-base font-medium text-text">{title}</p>
      {description ? <p className="max-w-sm text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState, type EmptyStateProps };
