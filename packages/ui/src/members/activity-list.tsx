import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "../community/empty-state";
import { RelativeTime } from "../community/relative-time";
import { cn } from "../lib/utils";

interface ActivityItem {
  type: "post" | "comment";
  title?: string | null;
  excerpt?: string | null;
  href: string;
  createdAt: string | Date;
}

interface ActivityListProps {
  items: ActivityItem[];
  emptyState?: ReactNode;
  now?: Date;
  locale?: string;
  label?: string;
  className?: string;
}

const TYPE_LABELS: Record<ActivityItem["type"], string> = {
  post: "Posted",
  comment: "Commented",
};

function ActivityList({
  items,
  emptyState,
  now,
  locale,
  label = "Recent activity",
  className,
}: ActivityListProps) {
  if (items.length === 0) {
    return <>{emptyState ?? <EmptyState title="No posts or comments yet." />}</>;
  }

  return (
    <ul data-slot="activity-list" aria-label={label} className={cn("flex flex-col", className)}>
      {items.map((item) => {
        const Icon = item.type === "post" ? FileTextIcon : MessageSquareIcon;
        const text = item.title || item.excerpt || TYPE_LABELS[item.type];
        return (
          <li key={`${item.type}:${item.href}`}>
            <a
              href={item.href}
              className="flex min-h-11 items-start gap-3 rounded-md px-2 py-3 outline-none transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "line-clamp-2 text-sm text-text",
                    item.title ? "font-medium" : undefined,
                  )}
                >
                  {text}
                </span>
                <span className="text-xs text-text-muted">
                  {TYPE_LABELS[item.type]}
                  <span aria-hidden="true"> · </span>
                  <RelativeTime value={item.createdAt} now={now} locale={locale} />
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export { ActivityList, type ActivityItem, type ActivityListProps };
