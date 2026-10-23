import { imageSrcSetFromUrl } from "@cohory/storage/variants";
import { Avatar, AvatarFallback, AvatarImage } from "@cohory/ui";
import { CalendarDays, Star } from "lucide-react";

import type { VisitorHeroData } from "../../lib/communities/about";
import { stickyJoinable } from "../../lib/communities/about-offer";
import { initials } from "../../lib/format";
import { averageLabel, reviewCountLabel } from "../../lib/reviews/views";
import { JoinPanel } from "../joining/join-panel";
import { ClampedDescription } from "./clamped-description";
import { CommunityMeta } from "./community-meta";
import { StoredImage } from "../stored-image";

export function VisitorHero({ hero }: { hero: VisitorHeroData }) {
  const join = (
    <JoinPanel slug={hero.slug} name={hero.name} state={hero.joinState} note={hero.offer.note} />
  );
  const dialogJoin = stickyJoinable(hero.joinState) ? (
    <JoinPanel slug={hero.slug} name={hero.name} state={hero.joinState} repeated />
  ) : null;
  return (
    <section aria-labelledby="community-name" className="border-b border-border bg-surface">
      {hero.coverUrl ? (
        <div className="mx-auto max-w-5xl md:px-4 md:pt-4">
          <StoredImage
            data-slot="community-cover"
            src={hero.coverUrl}
            srcSet={imageSrcSetFromUrl(hero.coverUrl) ?? undefined}
            sizes="(min-width: 1024px) 992px, 100vw"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="aspect-[3/1] w-full object-cover md:aspect-[4/1] md:rounded-lg"
          />
        </div>
      ) : null}
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            id="community-name"
            className="text-2xl font-semibold break-words text-text md:text-3xl"
          >
            {hero.name}
          </h1>
          <CommunityMeta privacy={hero.privacy} memberCount={hero.memberCount}>
            {hero.rating ? (
              <a
                href="#reviews"
                className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Star
                  aria-hidden="true"
                  className="size-4 fill-warning text-warning"
                  strokeWidth={1.5}
                />
                <span className="font-medium text-text">{averageLabel(hero.rating.average)}</span>
                <span>({reviewCountLabel(hero.rating.count)})</span>
              </a>
            ) : null}
          </CommunityMeta>
          {hero.nextEvent ? (
            <p className="flex items-center gap-1 text-sm text-text-muted">
              <CalendarDays aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.5} />
              {hero.nextEvent}
            </p>
          ) : null}
          {hero.owner ? (
            <p className="flex items-center gap-2 text-sm text-text">
              <Avatar aria-hidden="true" className="size-6">
                {hero.owner.image ? <AvatarImage src={hero.owner.image} alt="" /> : null}
                <AvatarFallback className="text-xs text-accent">
                  {initials(hero.owner.name)}
                </AvatarFallback>
              </Avatar>
              {hero.hasHost ? (
                <a
                  href="#host"
                  className="rounded-sm underline decoration-border underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring"
                >
                  By {hero.owner.name}
                </a>
              ) : (
                <span>By {hero.owner.name}</span>
              )}
            </p>
          ) : null}
          {hero.description ? (
            <ClampedDescription name={hero.name} text={hero.description} join={dialogJoin} />
          ) : null}
        </div>
        <div id="join" className="flex w-full shrink-0 flex-col md:w-auto md:max-w-72 md:items-end">
          {join}
        </div>
      </div>
    </section>
  );
}
