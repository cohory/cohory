"use client";

import { NotificationBell, type NotificationItem } from "@cohory/ui";
import { useCallback, useEffect, useState } from "react";

const pollIntervalMs = 60_000;

interface ApiNotification {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly preview: string | null;
  readonly actor: { readonly name: string; readonly image: string | null };
  readonly href: string;
  readonly readAt: string | null;
  readonly createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseUnreadCount(body: unknown): number {
  const count = isRecord(body) ? body.unreadCount : undefined;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new Error("invalid unread count");
  }
  return count;
}

function parseNotification(value: unknown): ApiNotification {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.text === "string" &&
    isNullableString(value.preview ?? null) &&
    isRecord(value.actor) &&
    typeof value.actor.name === "string" &&
    isNullableString(value.actor.image) &&
    typeof value.href === "string" &&
    value.href.startsWith("/") &&
    isRecord(value.community) &&
    typeof value.community.slug === "string" &&
    isNullableString(value.readAt) &&
    typeof value.createdAt === "string"
  ) {
    return {
      id: value.id,
      type: value.type,
      text: value.text,
      preview: typeof value.preview === "string" ? value.preview : null,
      actor: { name: value.actor.name, image: value.actor.image },
      href: value.href,
      readAt: value.readAt,
      createdAt: value.createdAt,
    };
  }
  throw new Error("invalid notification");
}

interface ApiPage {
  readonly data: ApiNotification[];
  readonly nextCursor: string | null;
}

function parsePage(body: unknown): ApiPage {
  const data = isRecord(body) ? body.data : undefined;
  const nextCursor = isRecord(body) ? body.nextCursor : undefined;
  if (!Array.isArray(data) || !isNullableString(nextCursor)) {
    throw new Error("invalid notification list");
  }
  return { data: data.map(parseNotification), nextCursor };
}

const pageSize = 20;

function pagePath(cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (cursor) query.set("cursor", cursor);
  return `?${query.toString()}`;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1/notifications${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(`notifications request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function postJson(path: string, body?: unknown): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function NotificationBellClient({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [serverUnread, setServerUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(initialUnread);
  }
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      setUnread(parseUnreadCount(await request("/unread-count")));
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refreshCount();
    }, pollIntervalMs);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  async function loadList() {
    setLoading(true);
    try {
      const page = parsePage(await request(pagePath(null)));
      setItems(page.data);
      setNextCursor(page.nextCursor);
    } catch {
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = parsePage(await request(pagePath(nextCursor)));
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.data.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      return;
    } finally {
      setLoadingMore(false);
    }
  }

  const notifications: NotificationItem[] = items.map((item) => ({
    id: item.id,
    text: item.text,
    preview: item.preview,
    createdAt: item.createdAt,
    read: item.readAt !== null,
    href: item.href.startsWith("//") ? "/" : item.href,
    actor: {
      name: item.actor.name,
      avatarUrl: item.actor.image,
      agent: item.type === "approval_request",
    },
  }));

  return (
    <NotificationBell
      unreadCount={unread}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadList();
      }}
      notifications={notifications}
      loading={loading}
      loadingMore={loadingMore}
      onLoadMore={nextCursor ? () => void loadMore() : undefined}
      onSelect={(selected) => {
        const item = items.find((entry) => entry.id === selected.id);
        if (!item) return;
        setOpen(false);
        if (item.readAt === null) {
          setUnread((count) => Math.max(0, count - 1));
          void postJson("/read", { ids: [item.id] }).catch(() => refreshCount());
        }
      }}
      onMarkAllRead={() => {
        const now = new Date().toISOString();
        setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
        setUnread(0);
        void postJson("/read-all").catch(() => refreshCount());
      }}
    />
  );
}
