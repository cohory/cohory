import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devSeed } from "@cohory/db/seed";
import { eq } from "drizzle-orm";

import { CalendarNotFoundError } from "./errors";
import { createPostgresCalendarRepository } from "./postgres-repository";
import { createCalendarService } from "./service";
import type { CreateEventInput } from "./schemas";
import { addDays, formatWallClock, toWallClock } from "./wall-clock";

export interface CalendarSeedResult {
  eventsCreated: number;
}

export const devSingleEventSlug = "creator-onboarding";
export const devSeriesSlug = "office-hours";

function nextWeek(now: Date): string {
  const today = toWallClock(now, "Europe/Berlin");
  return formatWallClock({ ...addDays(today, 7), hour: 18, minute: 0 });
}

export function devEvents(now: Date): readonly (CreateEventInput & { slug: string })[] {
  return [
    {
      slug: devSeriesSlug,
      title: "Office hours",
      description:
        "Every Thursday at 17:00 Berlin time: an hour with the Cohory team. Bring a question about courses, payments, or self-hosting, or show us what you are building. The time holds through the October and March clock changes.",
      startsAtLocal: "2026-10-22T17:00",
      timeZone: "Europe/Berlin",
      durationMinutes: 60,
      recurrence: "weekly",
      recurrenceUntil: "2027-04-29",
      location: "https://meet.example.com/cohory-office-hours",
    },
    {
      slug: devSingleEventSlug,
      title: "Creator onboarding",
      description:
        "New to Cohory? In 45 minutes we set up a community together: About page, join settings, categories, a first course, and a paid plan in Stripe test mode. Questions welcome.",
      startsAtLocal: nextWeek(now),
      timeZone: "Europe/Berlin",
      durationMinutes: 45,
      location: "https://meet.example.com/cohory-onboarding",
    },
  ];
}

export async function seedDevEvents(db: Database, now = new Date()): Promise<CalendarSeedResult> {
  const community = await getCommunityBySlug(db, devSeed.communitySlug);
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, devSeed.email))
    .limit(1);
  if (!community || !owner) {
    throw new Error("run the base seed before seeding events");
  }
  const service = createCalendarService({
    repo: createPostgresCalendarRepository(db),
    now: () => now,
  });
  const actor: Actor = { kind: "user", userId: owner.id, platformAdmin: false };
  let eventsCreated = 0;
  for (const { slug, ...input } of devEvents(now)) {
    try {
      await service.getEvent(actor, community.id, slug);
      continue;
    } catch (error: unknown) {
      if (!(error instanceof CalendarNotFoundError)) {
        throw error;
      }
    }
    await service.createEvent(actor, community.id, input);
    eventsCreated += 1;
  }
  return { eventsCreated };
}
