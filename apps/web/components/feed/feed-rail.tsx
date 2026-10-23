import { ForbiddenError } from "@cohory/authz";
import { GamificationCommunityNotFoundError, getGamificationService } from "@cohory/gamification";
import { getMembersService } from "@cohory/members";
import { AuthorAvatar } from "@cohory/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { occurrenceHref } from "../../lib/calendar/hrefs";
import { loadNextForViewer } from "../../lib/calendar/load";
import { viewerTimeZone } from "../../lib/calendar/viewer-time-zone";
import type { FullCommunityPage } from "../../lib/communities/load";
import { lessonHref } from "../../lib/courses/hrefs";
import { loadContinueLearning } from "../../lib/courses/load";
import { canListMembers, canReadLeaderboard } from "../../lib/members/permissions";
import { memberHref } from "../../lib/members/views";
import { communityAccess } from "../../lib/posts/load";

const railSize = 5;

interface RailPerson {
  readonly userId: string;
  readonly name: string;
  readonly image: string | null;
  readonly detail?: string;
}

const linkClass =
  "rounded-sm font-medium text-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function RailCard({
  title,
  slot,
  children,
}: {
  title: string;
  slot?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-slot={slot}
      className="flex flex-col gap-3 rounded-(--card-radius) border border-border bg-surface p-4 shadow-(--card-shadow)"
    >
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function PeopleList({ slug, people }: { slug: string; people: readonly RailPerson[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {people.map((person) => (
        <li key={person.userId} className="flex min-w-0 items-center gap-2 text-sm">
          <AuthorAvatar name={person.name} avatarUrl={person.image} className="size-8" />
          <Link href={memberHref(slug, person.userId)} className={`${linkClass} truncate`}>
            {person.name}
          </Link>
          {person.detail ? (
            <span className="ml-auto shrink-0 text-text-muted tabular-nums">{person.detail}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

async function weeklyLeaders(page: FullCommunityPage): Promise<RailPerson[]> {
  if (!canReadLeaderboard(communityAccess(page))) return [];
  try {
    const board = await getGamificationService().getLeaderboard(page.actor, page.community.id, {
      window: "7d",
    });
    if (board.status === "disabled") return [];
    return board.entries.slice(0, railSize).map((entry) => ({
      userId: entry.userId,
      name: entry.name,
      image: entry.image,
      detail: entry.points === 1 ? "1 point" : `${entry.points} points`,
    }));
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof GamificationCommunityNotFoundError) {
      return [];
    }
    throw error;
  }
}

async function newestMembers(page: FullCommunityPage): Promise<RailPerson[]> {
  if (!canListMembers(communityAccess(page))) return [];
  try {
    const result = await getMembersService().searchMembers(page.actor, page.community.id, {
      limit: railSize,
    });
    return result.data.map((member) => ({
      userId: member.userId,
      name: member.name,
      image: member.image,
    }));
  } catch (error) {
    if (error instanceof ForbiddenError) return [];
    throw error;
  }
}

export async function FeedRail({ page }: { page: FullCommunityPage }) {
  const [learning, next, leaders, joined, zone] = await Promise.all([
    loadContinueLearning(page),
    loadNextForViewer(page),
    weeklyLeaders(page),
    newestMembers(page),
    viewerTimeZone(),
  ]);
  const slug = page.community.slug;
  const event = next.find((occurrence) => !occurrence.canceled) ?? null;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: zone.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (!learning && !event && leaders.length === 0 && joined.length === 0) return null;

  return (
    <aside aria-label="Community highlights" className="hidden flex-col gap-4 lg:flex">
      {learning ? (
        <RailCard title="Continue learning" slot="continue-learning-card">
          <p className="flex items-center gap-2 text-sm">
            <Link
              href={lessonHref(slug, learning.course.slug, learning.lesson.slug)}
              className={`${linkClass} min-w-0 flex-1 truncate`}
            >
              <span className="sr-only">Continue </span>
              {learning.lesson.title}
            </Link>
            <span className="shrink-0 text-text-muted tabular-nums">
              {learning.progressPercent}%
            </span>
          </p>
        </RailCard>
      ) : null}
      {event ? (
        <RailCard title="Next event" slot="upcoming-events-card">
          <p className="flex flex-col gap-1 text-sm">
            <Link href={occurrenceHref(slug, event.eventSlug, event.id)} className={linkClass}>
              {event.title}
            </Link>
            <span className="text-text-muted">{when.format(new Date(event.startsAt))}</span>
          </p>
        </RailCard>
      ) : null}
      {leaders.length > 0 ? (
        <RailCard title="Top this week">
          <PeopleList slug={slug} people={leaders} />
          <Link href={`/c/${slug}/members/leaderboard`} className={`${linkClass} text-sm`}>
            See the leaderboard
          </Link>
        </RailCard>
      ) : null}
      {joined.length > 0 ? (
        <RailCard title="New members">
          <PeopleList slug={slug} people={joined} />
        </RailCard>
      ) : null}
    </aside>
  );
}
