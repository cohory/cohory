"use client";

import { cn } from "@cohory/ui/lib/utils";
import { useEffect, useState, type ReactNode } from "react";

export const heroJoinId = "join";
export const closingJoinId = "about-closing";

const platformBarHeight = "-56px";

function watched(id: string): Element | null {
  const element = document.getElementById(id);
  return element?.querySelector("a, button") ?? element;
}

export function StickyJoinBar({
  name,
  price,
  aboveTabs,
  children,
}: {
  name: string;
  price: string | null;
  aboveTabs: boolean;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const targets = [heroJoinId, closingJoinId].map(watched).filter((element) => element !== null);
    if (targets.length === 0) return;
    const visible = new Map<Element, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target, entry.isIntersecting);
        }
        setShown(![...visible.values()].some(Boolean));
      },
      { rootMargin: `${platformBarHeight} 0px 0px 0px` },
    );
    for (const target of targets) {
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <aside
      aria-label={`Join ${name}`}
      data-slot="sticky-join"
      hidden={!shown}
      className={cn(
        "fixed inset-x-0 z-(--z-nav) border-t border-border bg-surface px-4 py-3 lg:hidden",
        aboveTabs
          ? "bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0"
          : "bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-sm font-medium text-text">{name}</p>
          {price ? (
            <p className="truncate text-sm text-text-muted">{price} · Cancel anytime</p>
          ) : null}
        </div>
        <div className="flex min-w-0 md:shrink-0 [&_a]:w-auto [&_button]:w-auto [&_form]:w-auto">
          {children}
        </div>
      </div>
    </aside>
  );
}
