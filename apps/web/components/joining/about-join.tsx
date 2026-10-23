import type { ReactNode } from "react";

import type { JoinOffer } from "../../lib/communities/about-offer";
import { aboutCard, WhatYouGetList } from "../about/about-blocks";
import { closingJoinId } from "./sticky-join-bar";

const cardHighlights = 3;

function Price({ offer }: { offer: JoinOffer }) {
  if (!offer.price) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xl font-semibold text-text">{offer.price}</p>
      {offer.note ? <p className="text-sm text-text-muted">{offer.note}</p> : null}
    </div>
  );
}

export function JoinCard({
  name,
  offer,
  lines,
  children,
}: {
  name: string;
  offer: JoinOffer;
  lines: readonly string[];
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={`Join ${name}`}
      data-slot="join-card"
      className={`${aboutCard} flex flex-col gap-4`}
    >
      <p className="text-base font-medium break-words text-text">{name}</p>
      <Price offer={offer} />
      {lines.length > 0 ? <WhatYouGetList lines={lines.slice(0, cardHighlights)} /> : null}
      <div className="flex flex-col [&_a]:w-full [&_button]:w-full [&_form]:w-full">{children}</div>
      {offer.price ? <p className="text-sm text-text-muted">Taxes may apply.</p> : null}
    </aside>
  );
}

export function AboutClosing({
  name,
  offer,
  children,
}: {
  name: string;
  offer: JoinOffer;
  children: ReactNode;
}) {
  return (
    <section
      id={closingJoinId}
      aria-label={`Join ${name}`}
      className={`${aboutCard} flex flex-col items-start gap-3`}
    >
      <h3 className="text-xl break-words text-text">Join {name}</h3>
      {offer.price ? <p className="text-base text-text">{offer.price}</p> : null}
      <div className="flex w-full flex-col md:w-auto">{children}</div>
      {offer.price ? (
        <p className="text-sm text-text-muted">Cancel anytime from your account.</p>
      ) : null}
    </section>
  );
}
