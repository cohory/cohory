import type { CommunityRole } from "@cohory/authz";

import { memberHref } from "../members/views";

export const welcomeWindowDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

export type WelcomeStepKey = "photoAndBio" | "introduce" | "firstLesson" | "rsvpNext";

export interface WelcomeStep {
  readonly key: WelcomeStepKey;
  readonly title: string;
  readonly done: boolean;
  readonly href: string;
}

export interface WelcomeFacts {
  readonly hasPhoto: boolean;
  readonly hasBio: boolean;
  readonly hasPosted: boolean;
  readonly firstCourseSlug: string | null;
  readonly startedLearning: boolean;
  readonly nextEventHref: string | null;
  readonly goingToEvent: boolean;
}

export interface WelcomeWindow {
  readonly role: CommunityRole | null;
  readonly joinedAt: Date | null;
  readonly dismissed: boolean;
  readonly now: Date;
}

export function inWelcomeWindow({ role, joinedAt, dismissed, now }: WelcomeWindow): boolean {
  if (role === null || role === "owner" || dismissed || joinedAt === null) return false;
  return now.getTime() - joinedAt.getTime() < welcomeWindowDays * dayMs;
}

export function introduceHref(slug: string): string {
  return `/c/${encodeURIComponent(slug)}?compose=1`;
}

export function welcomeSteps(slug: string, userId: string, facts: WelcomeFacts): WelcomeStep[] {
  const base = `/c/${encodeURIComponent(slug)}`;
  const steps: WelcomeStep[] = [
    {
      key: "photoAndBio",
      title: "Add a photo and bio",
      done: facts.hasPhoto && facts.hasBio,
      href: facts.hasPhoto ? memberHref(slug, userId) : "/account",
    },
    {
      key: "introduce",
      title: "Introduce yourself",
      done: facts.hasPosted,
      href: introduceHref(slug),
    },
  ];
  if (facts.firstCourseSlug !== null || facts.startedLearning) {
    steps.push({
      key: "firstLesson",
      title: "Start the first lesson",
      done: facts.startedLearning,
      href: facts.firstCourseSlug
        ? `${base}/classroom/${encodeURIComponent(facts.firstCourseSlug)}`
        : `${base}/classroom`,
    });
  }
  if (facts.nextEventHref !== null || facts.goingToEvent) {
    steps.push({
      key: "rsvpNext",
      title: "RSVP to the next event",
      done: facts.goingToEvent,
      href: facts.nextEventHref ?? `${base}/calendar`,
    });
  }
  return steps;
}
