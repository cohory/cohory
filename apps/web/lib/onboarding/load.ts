import { getCoursesService } from "@cohory/api/services";
import { ForbiddenError } from "@cohory/authz";
import { CoursesError, type ContinueLearning } from "@cohory/courses";
import { getMembersService, MembersError } from "@cohory/members";
import type { EventOccurrence } from "@cohory/ui";
import { cache } from "react";

import { occurrenceHref } from "../calendar/hrefs";
import type { FullCommunityPage } from "../communities/load";
import { inWelcomeWindow, welcomeSteps, type WelcomeStep } from "./welcome";

export interface MyFeedProfile {
  readonly hasPhoto: boolean;
  readonly hasBio: boolean;
  readonly hasPosted: boolean;
}

export const loadMyFeedProfile = cache(
  async (page: FullCommunityPage): Promise<MyFeedProfile | null> => {
    if (page.role === null || page.actor.kind !== "user") return null;
    try {
      const profile = await getMembersService().getMemberProfile(
        page.actor,
        page.community.id,
        page.actor.userId,
      );
      return {
        hasPhoto: profile.image !== null,
        hasBio: (profile.bio?.trim() ?? "") !== "",
        hasPosted: profile.recentActivity.posts.length > 0,
      };
    } catch (error) {
      if (error instanceof MembersError || error instanceof ForbiddenError) return null;
      throw error;
    }
  },
);

async function firstCourseSlug(page: FullCommunityPage): Promise<{
  slug: string | null;
  started: boolean;
}> {
  try {
    const courses = await getCoursesService().listCourses(page.actor, page.community.id);
    const published = courses.filter(
      (course) => course.status === "published" && course.publishedLessonCount > 0,
    );
    return {
      slug: published[0]?.slug ?? null,
      started: published.some((course) => course.completedLessonCount > 0),
    };
  } catch (error) {
    if (error instanceof CoursesError || error instanceof ForbiddenError) {
      return { slug: null, started: false };
    }
    throw error;
  }
}

export async function loadWelcomeSteps(
  page: FullCommunityPage,
  learning: ContinueLearning | null,
  nextEvents: readonly EventOccurrence[],
  now: Date = new Date(),
): Promise<WelcomeStep[] | null> {
  const shown = inWelcomeWindow({
    role: page.role,
    joinedAt: page.membership?.joinedAt ?? null,
    dismissed: page.onboardingDismissed,
    now,
  });
  if (!shown || page.actor.kind !== "user") return null;
  const [profile, course] = await Promise.all([loadMyFeedProfile(page), firstCourseSlug(page)]);
  if (!profile) return null;
  const slug = page.community.slug;
  const [nextEvent] = nextEvents;
  const steps = welcomeSteps(slug, page.actor.userId, {
    ...profile,
    firstCourseSlug: course.slug,
    startedLearning: course.started || learning !== null,
    nextEventHref: nextEvent ? occurrenceHref(slug, nextEvent.eventSlug, nextEvent.id) : null,
    goingToEvent: nextEvents.some((occurrence) => occurrence.viewerStatus === "going"),
  });
  return steps.every((step) => step.done) ? null : steps;
}
