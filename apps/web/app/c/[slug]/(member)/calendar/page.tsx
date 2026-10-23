import { Button, EventListSkeleton, Skeleton } from "@cohory/ui";
import { Lock, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CalendarPageView } from "../../../../../components/calendar/calendar-view";
import { TimeZoneSync } from "../../../../../components/calendar/time-zone-sync";
import { EmptyState } from "../../../../../components/empty-state";
import { newEventHref } from "../../../../../lib/calendar/hrefs";
import { loadCalendar } from "../../../../../lib/calendar/load";
import { parseMonth, parseView, type CalendarView } from "../../../../../lib/calendar/params";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Calendar" };

function CalendarSkeleton() {
  return (
    <div role="status" aria-label="Loading events" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-9 w-44" />
      <EventListSkeleton />
    </div>
  );
}

export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/calendar">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const view = parseView(search.view);
  const month = parseMonth(search.month);
  return (
    <Suspense key={`${view}-${month}`} fallback={<CalendarSkeleton />}>
      <Calendar slug={slug} view={view} month={month} />
    </Suspense>
  );
}

async function Calendar({
  slug,
  view,
  month,
}: {
  slug: string;
  view: CalendarView | null;
  month: string | null;
}) {
  const data = await loadCalendar(slug, { view, month });
  const communitySlug = data.page.community.slug;

  if (data.status === "forbidden") {
    return (
      <EmptyState icon={Lock} title="Events are for members">
        Join this community to see its events.
      </EmptyState>
    );
  }

  return (
    <section aria-labelledby="calendar-heading" className="flex flex-col gap-4">
      <TimeZoneSync current={data.zone.cookie} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="calendar-heading" className="text-xl text-text">
          Calendar
        </h2>
        {data.manager ? (
          <Button asChild>
            <Link href={newEventHref(communitySlug)}>
              <PlusIcon className="size-4" aria-hidden="true" />
              New event
            </Link>
          </Button>
        ) : null}
      </div>
      <CalendarPageView
        slug={communitySlug}
        view={view}
        month={data.month}
        timeZone={data.zone.timeZone}
        monthOccurrences={data.monthOccurrences}
        listOccurrences={data.listOccurrences}
        pastOccurrences={data.pastOccurrences}
        canRsvp={data.canRsvp}
      />
    </section>
  );
}
