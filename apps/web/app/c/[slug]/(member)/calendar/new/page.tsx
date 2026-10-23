import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventFormPanel } from "../../../../../../components/calendar/event-form-panel";
import { TimeZoneSync } from "../../../../../../components/calendar/time-zone-sync";
import { requireFullCommunityPage } from "../../../../../../lib/communities/load";
import { calendarHref } from "../../../../../../lib/calendar/hrefs";
import { canManageEvents } from "../../../../../../lib/calendar/load";
import { viewerTimeZone } from "../../../../../../lib/calendar/viewer-time-zone";
import { emptyFormValue, timeZoneOptions } from "../../../../../../lib/calendar/views";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({ params }: PageProps<"/c/[slug]/calendar/new">) {
  const page = await requireFullCommunityPage((await params).slug);
  if (!canManageEvents(page)) notFound();
  const zone = await viewerTimeZone();
  const slug = page.community.slug;

  return (
    <section
      aria-labelledby="new-event-heading"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6"
    >
      <TimeZoneSync current={zone.cookie} />
      <div className="flex flex-col gap-1">
        <Link href={calendarHref(slug)} className="text-sm text-text-muted hover:underline">
          Back to calendar
        </Link>
        <h1 id="new-event-heading" className="font-heading text-2xl text-text">
          New event
        </h1>
        <p className="text-sm text-text-muted">Members see the time in their own time zone.</p>
      </div>
      <EventFormPanel
        key={zone.timeZone}
        slug={slug}
        mode={{ kind: "create" }}
        initial={emptyFormValue(zone.timeZone, new Date())}
        timeZones={timeZoneOptions(zone.timeZone)}
        viewerTimeZone={zone.timeZone}
      />
    </section>
  );
}
