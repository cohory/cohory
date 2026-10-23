import { getCoursesService } from "@cohory/api/services";
import { ForbiddenError, UnauthenticatedError, type Actor } from "@cohory/authz";
import { CalendarError, getCalendarService, type NextEventTeaser } from "@cohory/calendar";
import { getCommunitiesService, type AboutView } from "@cohory/communities";
import { CoursesError } from "@cohory/courses";
import type { FaqItem } from "@cohory/db/schema";
import type { PostDocument } from "@cohory/ui";
import { getReviewsService } from "@cohory/reviews";
import { cache } from "react";

import { coverUrl } from "../courses/views";
import { paidJoinFor, planJoin } from "../payments/gating";
import { loadActivePlan } from "../payments/load";
import { toPostDocument } from "../posts/document";
import { joinOffer, whatYouGetLines, type AboutCounts, type JoinOffer } from "./about-offer";
import { loadJoinState, resolveJoinState, type JoinState } from "./join-state";
import { loadCommunityPage, type CommunityPage } from "./load";
import { nextEventLine } from "./next-event";
import { previewGaps, type PreviewGap } from "./preview";

export interface HeroRating {
  readonly average: number;
  readonly count: number;
}

export interface VisitorHeroData {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly coverUrl: string | null;
  readonly privacy: CommunityPage["community"]["privacy"];
  readonly memberCount: number;
  readonly owner: AboutView["owner"];
  readonly rating: HeroRating | null;
  readonly joinState: JoinState;
  readonly offer: JoinOffer;
  readonly hasHost: boolean;
  readonly nextEvent: string | null;
}

export interface CoursePreviewView {
  readonly title: string;
  readonly coverUrl: string | null;
  readonly lessonCount: number;
}

export interface AboutHost {
  readonly name: string;
  readonly image: string | null;
  readonly bio: string | null;
  readonly credential: string | null;
}

export interface AboutBodyData {
  readonly gallery: AboutView["gallery"];
  readonly detailedDescription: PostDocument | null;
  readonly whatYouGet: readonly string[];
  readonly host: AboutHost | null;
  readonly faq: readonly FaqItem[];
}

const loadAbout = cache(async (slug: string): Promise<AboutView> => {
  const page = await loadCommunityPage(slug);
  return getCommunitiesService().getAbout(page.actor, page.community.id);
});

async function loadRating(page: CommunityPage): Promise<HeroRating | null> {
  const summary = await getReviewsService().getSummary(page.actor, page.community.id);
  if (summary.status === "disabled" || summary.average === null) {
    return null;
  }
  return { average: summary.average, count: summary.count };
}

export const loadViewerJoinState = cache(async (slug: string): Promise<JoinState> => {
  const page = await loadCommunityPage(slug);
  const plan = await loadActivePlan(page.community.id);
  return loadJoinState(page, paidJoinFor(page, plan));
});

async function previewJoinState(page: CommunityPage): Promise<JoinState> {
  const plan = await loadActivePlan(page.community.id);
  const { community } = page;
  return resolveJoinState({
    signedIn: false,
    slug: community.slug,
    joinMode: community.joinMode,
    questions: community.joinQuestions,
    archived: page.access === "full" ? page.community.archivedAt !== null : false,
    paidJoin: plan ? planJoin(plan, community.joinQuestions.length > 0) : null,
    canRejoin: false,
    status: null,
  });
}

const loadHero = cache(async (slug: string, preview: boolean): Promise<VisitorHeroData> => {
  const page = await loadCommunityPage(slug);
  const { community } = page;
  const [about, rating, joinState, plan, nextEvent] = await Promise.all([
    loadAbout(slug),
    loadRating(page),
    preview ? previewJoinState(page) : loadViewerJoinState(slug),
    loadActivePlan(community.id),
    loadNextEvent(preview ? { kind: "guest" } : page.actor, community.id),
  ]);
  return {
    slug: community.slug,
    name: community.name,
    description: community.description,
    coverUrl: community.coverUrl,
    privacy: community.privacy,
    memberCount: community.memberCount,
    owner: about.owner,
    rating,
    joinState,
    offer: joinOffer(plan),
    hasHost: about.owner !== null && about.content.host !== null,
    nextEvent: nextEventLine(nextEvent),
  };
});

async function loadNextEvent(actor: Actor, communityId: string): Promise<NextEventTeaser | null> {
  try {
    return await getCalendarService().nextEventTeaser(actor, communityId);
  } catch (error) {
    if (error instanceof CalendarError) return null;
    throw error;
  }
}

export function loadVisitorHero(
  slug: string,
  options: { readonly preview: boolean } = { preview: false },
): Promise<VisitorHeroData> {
  return loadHero(slug, options.preview);
}

function hiddenFromVisitors(error: unknown): boolean {
  return (
    error instanceof CoursesError ||
    error instanceof CalendarError ||
    error instanceof ForbiddenError ||
    error instanceof UnauthenticatedError
  );
}

async function visitorCount(count: () => Promise<number>): Promise<number | null> {
  try {
    return await count();
  } catch (error) {
    if (hiddenFromVisitors(error)) return null;
    throw error;
  }
}

const upcomingWindowMs = 30 * 86_400_000;

async function loadAboutCounts(communityId: string): Promise<AboutCounts> {
  const guest = { kind: "guest" } as const;
  const from = new Date();
  const [courses, upcomingEvents] = await Promise.all([
    visitorCount(() => getCoursesService().countPublishedCourses(guest, communityId)),
    visitorCount(async () => {
      const occurrences = await getCalendarService().listOccurrences(guest, communityId, {
        from,
        to: new Date(from.getTime() + upcomingWindowMs),
      });
      return occurrences.filter((occurrence) => occurrence.canceledAt === null).length;
    }),
  ]);
  return { courses, upcomingEvents };
}

export const loadCoursePreviews = cache(async (slug: string): Promise<CoursePreviewView[]> => {
  const page = await loadCommunityPage(slug);
  try {
    const previews = await getCoursesService().listCoursePreviews(page.actor, page.community.id);
    return previews.map((course) => ({
      title: course.title,
      coverUrl: coverUrl(course.coverKey),
      lessonCount: course.lessonCount,
    }));
  } catch (error) {
    if (hiddenFromVisitors(error)) return [];
    throw error;
  }
});

export async function loadPreviewGaps(slug: string): Promise<PreviewGap[]> {
  const page = await loadCommunityPage(slug);
  const [about, reviews] = await Promise.all([
    loadAbout(slug),
    getReviewsService().getSummary(page.actor, page.community.id),
  ]);
  return previewGaps(page.community.slug, {
    hasCover: page.community.coverUrl !== null,
    galleryCount: about.gallery.length,
    hasDetailedDescription: page.community.detailedDescription !== null,
    reviewsOn: reviews.status !== "disabled",
  });
}

export async function loadSellerName(slug: string): Promise<string | null> {
  return (await loadAbout(slug)).owner?.name ?? null;
}

export async function loadAboutBody(slug: string): Promise<AboutBodyData> {
  const page = await loadCommunityPage(slug);
  const about = await loadAbout(slug);
  const { content, owner } = about;
  const counts: AboutCounts =
    content.whatYouGet.length > 0
      ? { courses: null, upcomingEvents: null }
      : await loadAboutCounts(page.community.id);
  const stored = page.community.detailedDescription;
  return {
    gallery: about.gallery,
    detailedDescription: stored ? toPostDocument(stored) : null,
    whatYouGet: whatYouGetLines(content.whatYouGet, counts),
    host: owner && content.host ? { ...owner, ...content.host } : null,
    faq: content.faq,
  };
}
