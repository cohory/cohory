import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const textLinkClass =
  "inline-flex min-h-11 items-center rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function MarketingSection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-border py-12">
      <div className="flex max-w-2xl flex-col gap-2">
        <h2 id={id} className="text-2xl text-balance text-text">
          {title}
        </h2>
        {lead ? <p className="text-base text-text-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${textLinkClass} self-start text-base`}>
      {children}
    </Link>
  );
}

export interface FaqItem {
  readonly question: string;
  readonly answer: ReactNode;
}

export function Faq({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="flex max-w-2xl flex-col divide-y divide-border">
      {items.map((item) => (
        <details key={item.question} className="group py-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-base font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {item.question}
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              strokeWidth={1.5}
            />
          </summary>
          <div className="max-w-prose pb-3 text-base text-text-muted">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
