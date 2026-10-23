import { Avatar, AvatarFallback, AvatarImage } from "@cohory/ui";
import type { FaqItem } from "@cohory/db/schema";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import type { AboutHost } from "../../lib/communities/about";
import { initials } from "../../lib/format";

export const aboutCard =
  "rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6";

export function WhatYouGetList({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2 text-base text-text">
          <Check
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-accent"
            strokeWidth={2}
          />
          <span className="min-w-0 break-words">{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={`${aboutCard} scroll-mt-20`}>
      <h3 id={`${id}-heading`} className="mb-4 text-xl text-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function WhatYouGet({ lines }: { lines: readonly string[] }) {
  return (
    <Block id="what-you-get" title="What you get">
      <WhatYouGetList lines={lines} />
    </Block>
  );
}

export function AboutHostBlock({ host }: { host: AboutHost }) {
  return (
    <Block id="host" title="About the host">
      <div className="flex items-start gap-4">
        <Avatar aria-hidden="true" className="size-16 shrink-0">
          {host.image ? <AvatarImage src={host.image} alt="" /> : null}
          <AvatarFallback className="text-lg text-accent">{initials(host.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-base font-medium text-text">{host.name}</p>
          {host.credential ? <p className="text-sm text-text-muted">{host.credential}</p> : null}
          {host.bio ? (
            <p className="mt-2 max-w-prose text-base whitespace-pre-line break-words text-text">
              {host.bio}
            </p>
          ) : null}
        </div>
      </div>
    </Block>
  );
}

export function AboutFaq({ items }: { items: readonly FaqItem[] }) {
  return (
    <Block id="faq" title="Questions">
      <div className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <details key={item.q} className="group py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-base font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                aria-hidden="true"
                className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                strokeWidth={1.5}
              />
            </summary>
            <p className="max-w-prose pb-3 text-base whitespace-pre-line break-words text-text-muted">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </Block>
  );
}
