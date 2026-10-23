import { PostContent } from "@cohory/ui";
import type { ReactNode } from "react";

import type { AboutBodyData, CoursePreviewView, VisitorHeroData } from "../lib/communities/about";
import { stickyJoinable } from "../lib/communities/about-offer";
import { AboutFaq, AboutHostBlock, aboutCard, WhatYouGet } from "./about/about-blocks";
import { AboutGallery } from "./about/about-gallery";
import { CurriculumPreview } from "./about/curriculum-preview";
import { AboutClosing, JoinCard } from "./joining/about-join";
import { JoinPanel } from "./joining/join-panel";
import { StickyJoinBar } from "./joining/sticky-join-bar";

export interface AboutJoin {
  readonly hero: VisitorHeroData;
  readonly aboveTabs: boolean;
}

export interface AboutCommunityProps {
  about: AboutBodyData;
  reviews?: ReactNode;
  join?: AboutJoin | null;
  courses?: readonly CoursePreviewView[];
}

export function AboutCommunity({ about, reviews, join = null, courses = [] }: AboutCommunityProps) {
  const hero = join && stickyJoinable(join.hero.joinState) ? join.hero : null;
  const control = hero ? (
    <JoinPanel slug={hero.slug} name={hero.name} state={hero.joinState} repeated />
  ) : null;
  const body = (
    <article aria-labelledby="about-heading" className="flex min-w-0 flex-col gap-6">
      <h2 id="about-heading" className="sr-only">
        About
      </h2>
      {about.gallery.length > 0 ? <AboutGallery items={about.gallery} /> : null}
      {about.whatYouGet.length > 0 ? <WhatYouGet lines={about.whatYouGet} /> : null}
      {about.detailedDescription ? (
        <div className={aboutCard}>
          <div className="max-w-prose">
            <PostContent headings document={about.detailedDescription} />
          </div>
        </div>
      ) : null}
      <CurriculumPreview courses={courses} />
      {about.host ? <AboutHostBlock host={about.host} /> : null}
      {reviews ? (
        <div data-slot="about-reviews" className={aboutCard}>
          {reviews}
        </div>
      ) : null}
      {about.faq.length > 0 ? <AboutFaq items={about.faq} /> : null}
      {hero ? (
        <AboutClosing name={hero.name} offer={hero.offer}>
          {control}
        </AboutClosing>
      ) : null}
    </article>
  );
  if (!hero || !join) {
    return body;
  }
  return (
    <>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8">
        {body}
        <div className="hidden lg:sticky lg:top-20 lg:block">
          <JoinCard name={hero.name} offer={hero.offer} lines={about.whatYouGet}>
            {control}
          </JoinCard>
        </div>
      </div>
      <StickyJoinBar name={hero.name} price={hero.offer.price} aboveTabs={join.aboveTabs}>
        {control}
      </StickyJoinBar>
    </>
  );
}
