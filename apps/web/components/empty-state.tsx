import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) px-6 py-12 text-center">
      <Icon aria-hidden="true" className="size-6 text-text-muted" strokeWidth={1.5} />
      <h2 className="text-lg text-text">{title}</h2>
      {children ? <div className="max-w-sm text-sm text-text-muted">{children}</div> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}
