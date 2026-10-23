"use client";

import {
  EventDetail,
  formatDateLong,
  SeriesScopeDialog,
  type SeriesDeletePreview,
  toast,
  type EventDetailEvent,
  type EventOccurrence,
  type ItemAction,
  type SeriesScope,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deleteEventAction,
  previewEventDeleteAction,
  setOccurrenceCanceledAction,
  setRecordingAction,
} from "../../lib/calendar/actions";
import { ConfirmDialog } from "../feed/confirm-dialog";
import { RecordingDialog } from "./recording-dialog";
import { useRsvp } from "./use-rsvp";

type OpenDialog = "scope" | "cancel" | "delete" | "recording" | null;

interface EventDetailViewProps {
  slug: string;
  eventSlug: string;
  occurrence: EventOccurrence;
  event: EventDetailEvent;
  viewerTimeZone: string;
  icsHref: string;
  editHref: string;
  canRsvp: boolean;
  manager: boolean;
}

function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(
    new Date(iso),
  );
}

export function EventDetailView(props: EventDetailViewProps) {
  const { slug, eventSlug, occurrence: raw, event, manager } = props;
  const router = useRouter();
  const { apply, rsvp, pendingId } = useRsvp(slug);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [scopePending, setScopePending] = useState<SeriesScope | null>(null);
  const [deletePreview, setDeletePreview] = useState<SeriesDeletePreview | null>(null);
  const occurrence = apply(raw);
  const weekly = occurrence.recurrence === "weekly";
  const dateLabel = formatDateLong(occurrence.startsAt, props.viewerTimeZone);

  function openScope() {
    setDialog("scope");
    setDeletePreview(null);
    previewEventDeleteAction({ slug, eventSlug })
      .then((result) => setDeletePreview(result.ok ? result.data : null))
      .catch(() => setDeletePreview(null));
  }

  async function setCanceled(canceled: boolean): Promise<void> {
    const result = await setOccurrenceCanceledAction({
      slug,
      occurrenceId: occurrence.id,
      canceled,
    });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setDialog(null);
    toast(canceled ? "Event canceled for this date." : "Event restored for this date.");
    router.refresh();
  }

  async function deleteEvent(): Promise<void> {
    const result = await deleteEventAction({ slug, eventSlug });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setDialog(null);
    toast(weekly ? "Series deleted." : "Event deleted.");
    router.push(result.data.href);
  }

  async function runScope(scope: SeriesScope) {
    setScopePending(scope);
    await (scope === "this" ? setCanceled(true) : deleteEvent());
    setScopePending(null);
  }

  const actions: ItemAction[] = manager
    ? [
        {
          id: "edit",
          label: "Edit event",
          href: props.editHref,
          onSelect: () => undefined,
        },
        {
          id: "recording",
          label: event.recordingUrl ? "Edit recording link" : "Add recording link",
          onSelect: () => setDialog("recording"),
        },
        occurrence.canceled
          ? {
              id: "restore",
              label: "Restore this date",
              onSelect: () => void setCanceled(false),
            }
          : {
              id: "cancel",
              label: weekly ? "Cancel or delete" : "Cancel event",
              variant: "danger",
              onSelect: () => (weekly ? openScope() : setDialog("cancel")),
            },
        ...(weekly
          ? []
          : [
              {
                id: "delete",
                label: "Delete event",
                variant: "danger" as const,
                onSelect: () => setDialog("delete"),
              },
            ]),
      ]
    : [];

  return (
    <>
      <EventDetail
        occurrence={occurrence}
        event={event}
        viewerTimeZone={props.viewerTimeZone}
        icsHref={props.icsHref}
        onRsvp={props.canRsvp ? (status) => rsvp(raw, status) : undefined}
        rsvpPending={pendingId === raw.id}
        actions={actions}
      />
      {manager ? (
        <>
          <SeriesScopeDialog
            open={dialog === "scope"}
            onOpenChange={(open) => setDialog(open ? "scope" : null)}
            dateLabel={shortDate(occurrence.startsAt, props.viewerTimeZone)}
            deletePreview={deletePreview}
            pending={scopePending}
            onThisOnly={() => void runScope("this")}
            onSeries={() => void runScope("series")}
          />
          <ConfirmDialog
            open={dialog === "cancel"}
            onOpenChange={(open) => setDialog(open ? "cancel" : null)}
            title="Cancel this event?"
            description={`Members will see it as canceled on ${dateLabel}. You can restore it later.`}
            confirmLabel="Cancel event"
            onConfirm={() => setCanceled(true)}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(open) => setDialog(open ? "delete" : null)}
            title="Delete this event?"
            description="The event and its RSVPs are removed. This can't be undone."
            confirmLabel="Delete event"
            onConfirm={deleteEvent}
          />
          {dialog === "recording" ? (
            <RecordingDialog
              open
              onOpenChange={(open) => setDialog(open ? "recording" : null)}
              initialUrl={event.recordingUrl ?? ""}
              onSave={async (url) => {
                const result = await setRecordingAction({ slug, eventSlug, recordingUrl: url });
                if (!result.ok) return result.message;
                toast(
                  result.data.recordingUrl ? "Recording link saved." : "Recording link removed.",
                );
                router.refresh();
                return null;
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
