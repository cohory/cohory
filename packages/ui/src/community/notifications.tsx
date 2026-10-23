"use client";

import { BellIcon, CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover";
import { Skeleton } from "../primitives/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { AuthorAvatar } from "./author-avatar";
import { EmptyState } from "./empty-state";
import { RelativeTime } from "./relative-time";

interface NotificationItem {
  id: string;
  text: ReactNode;
  preview?: string | null;
  createdAt: string | Date;
  read: boolean;
  href: string;
  actor?: { name: string; avatarUrl?: string | null; agent?: boolean };
}

interface NotificationListProps {
  notifications: NotificationItem[];
  onSelect(notification: NotificationItem): void;
  onMarkAllRead?(): void;
  onLoadMore?(): void;
  loading?: boolean;
  loadingMore?: boolean;
  now?: Date;
  className?: string;
}

const UNREAD_CAP = 99;

function formatUnreadCount(count: number): string {
  return count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(count);
}

function NotificationList({
  notifications,
  onSelect,
  onMarkAllRead,
  onLoadMore,
  loading = false,
  loadingMore = false,
  now,
  className,
}: NotificationListProps) {
  const hasUnread = notifications.some((notification) => !notification.read);

  return (
    <div data-slot="notification-list" className={cn("flex flex-col", className)}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold text-text">Notifications</h2>
        {hasUnread && onMarkAllRead ? (
          <Button variant="ghost" size="sm" className="text-accent" onClick={onMarkAllRead}>
            Mark all as read
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div role="status" aria-label="Loading notifications" className="flex flex-col gap-3 p-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={<CheckIcon />} title="You're all caught up." />
      ) : (
        <ul className="flex max-h-96 flex-col overflow-y-auto overscroll-contain py-1">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Link
                href={notification.href}
                data-state={notification.read ? "read" : "unread"}
                onClick={() => onSelect(notification)}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors duration-(--duration-fast) outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                {notification.actor?.agent ? (
                  <AgentAvatar />
                ) : notification.actor ? (
                  <AuthorAvatar
                    name={notification.actor.name}
                    avatarUrl={notification.actor.avatarUrl}
                    className="size-8"
                  />
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-text", !notification.read && "font-medium")}>
                    {notification.text}
                  </span>
                  {notification.preview ? (
                    <span className="line-clamp-1 text-text-muted">{notification.preview}</span>
                  ) : null}
                  <RelativeTime
                    value={notification.createdAt}
                    now={now}
                    className="text-xs text-text-muted"
                  />
                </span>
                {notification.read ? null : (
                  <span className="mt-1.5 flex shrink-0 items-center">
                    <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                    <span className="sr-only">Unread</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
          {onLoadMore ? (
            <li className="px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "Loading older notifications…" : "Show older notifications"}
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

interface NotificationBellProps extends NotificationListProps {
  unreadCount: number;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}

function NotificationBell({
  unreadCount,
  open,
  onOpenChange,
  className,
  ...listProps
}: NotificationBellProps) {
  const label =
    unreadCount > 0 ? `Notifications, ${formatUnreadCount(unreadCount)} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            aria-label={label}
            className={cn(
              "relative inline-flex size-11 items-center justify-center rounded-md text-text-muted transition-colors duration-(--duration-fast) outline-none hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              className,
            )}
          >
            <BellIcon className="size-5" aria-hidden="true" />
            {unreadCount > 0 ? (
              <Badge
                variant="count"
                aria-hidden="true"
                data-slot="notification-count"
                className="absolute top-1 right-1 h-4 min-w-4 px-1 leading-none"
              >
                {formatUnreadCount(unreadCount)}
              </Badge>
            ) : null}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        aria-label="Notifications"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
      >
        <NotificationList {...listProps} />
      </PopoverContent>
    </Popover>
  );
}

export {
  formatUnreadCount,
  NotificationBell,
  NotificationList,
  type NotificationBellProps,
  type NotificationItem,
  type NotificationListProps,
};
