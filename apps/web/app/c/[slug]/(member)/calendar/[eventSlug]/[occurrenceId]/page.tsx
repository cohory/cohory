import type { Metadata } from "next";
import Link from "next/link";

import { EventDetailView } from "../../../../../../../components/calendar/event-detail-view";
import { EventFormPanel } from "../../../../../../../components/calendar/event-form-panel";
import { TimeZoneSync } from "../../../../../../../components/calendar/time-zone-sync";
import {
  calendarHref,
  occurrenceHref,
  occurrenceIcsHref,
} from "../../../../../../../lib/calendar/hrefs";
import { loadOccurrence } from "../../../../../../../lib/calendar/load";
import { parseEditFlag } from "../../../../../../../lib/calendar/params";
import {
  timeZoneOptions,
  toDetailEvent,
  toDetailOccurrence,
  toFormValue,
} from "../../../../../../../lib/calendar/views";

export const dynamic = "force-dynamic";

type Props = PageProps<"/c/[slug]/calendar/[eventSlug]/[occurrenceId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, eventSlug, occurrenceId } = await params;
  const { detail } = await loadOccurrence(slug, eventSlug, occurrenceId);
  return { title: detail.event.title };
}

export default async function OccurrencePage({ params, searchParams }: Props) {
  const [{ slug, eventSlug, occurrenceId }, search] = await Promise.all([params, searchParams]);
  const { page, detail, zone, manager, canRsvp } = await loadOccurrence(
    slug,
    eventSlug,
    occurrenceId,
  );
  const communitySlug = page.community.slug;
  const href = occurrenceHref(communitySlug, detail.event.slug, detail.id);

  if (manager && parseEditFlag(search.edit)) {
    return (
      <section
        aria-labelledby="edit-event-heading"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6"
      >
        <div className="flex flex-col gap-1">
          <Link href={href} className="text-sm text-text-muted hover:underline">
            Back to event
          </Link>
          <h1 id="edit-event-heading" className="font-heading text-2xl text-text">
            Edit event
          </h1>
          <p className="text-sm text-text-muted">
            {detail.event.recurrence === "weekly"
              ? "Changes apply to every upcoming date in the series. Members who said they are going keep their RSVP."
              : "Members who said they are going keep their RSVP."}
          </p>
        </div>
        <EventFormPanel
          slug={communitySlug}
          mode={{ kind: "edit", eventSlug: detail.event.slug, occurrenceId: detail.id }}
          initial={toFormValue(detail.event)}
          timeZones={timeZoneOptions(detail.event.timeZone)}
          viewerTimeZone={zone.timeZone}
        />
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <TimeZoneSync current={zone.cookie} />
      <Link href={calendarHref(communitySlug)} className="text-sm text-text-muted hover:underline">
        Back to calendar
      </Link>
      <EventDetailView
        slug={communitySlug}
        eventSlug={detail.event.slug}
        occurrence={toDetailOccurrence(detail)}
        event={toDetailEvent(detail)}
        viewerTimeZone={zone.timeZone}
        icsHref={occurrenceIcsHref(communitySlug, detail.id)}
        editHref={occurrenceHref(communitySlug, detail.event.slug, detail.id, { edit: true })}
        canRsvp={canRsvp}
        manager={manager}
      />
    </div>
  );
}
