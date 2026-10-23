"use server";

import {
  getCalendarService,
  type EventChangePreview,
  type EventDeletePreview,
} from "@cohory/calendar";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { resolveCommunity, type CommunityContext } from "../posts/context";
import { calendarActionFailure, type CalendarActionResult } from "./errors";
import { calendarHref, occurrenceHref } from "./hrefs";
import {
  createEventSchema,
  deletePreviewSchema,
  eventRefSchema,
  previewEventChangeSchema,
  recordingSchema,
  rsvpSchema,
  setCanceledSchema,
  toServiceInput,
  updateEventSchema,
  type CreateEventActionInput,
  type EventRefInput,
  type PreviewEventChangeInput,
  type RecordingActionInput,
  type RsvpActionInput,
  type SetCanceledInput,
  type UpdateEventActionInput,
} from "./schemas";

async function run<I extends { slug: string }, T>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, context: CommunityContext) => Promise<T>,
): Promise<CalendarActionResult<T>> {
  try {
    const input = schema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return { ok: true, data: await fn(input, context) };
  } catch (error) {
    const failure = calendarActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

interface ChangedOccurrence {
  readonly eventSlug: string;
  readonly occurrenceId: string;
}

function revalidateCalendar(context: CommunityContext, changed?: ChangedOccurrence): void {
  revalidatePath(`/c/${context.slug}`, "layout");
  revalidatePath(calendarHref(context.slug));
  if (changed) {
    revalidatePath(occurrenceHref(context.slug, changed.eventSlug, changed.occurrenceId));
  }
}

const calendar = getCalendarService;

async function landingHref(
  context: CommunityContext,
  eventSlug: string,
  preferredOccurrenceId: string | null,
  fallbackMonth: string,
): Promise<string> {
  const event = await calendar().getEvent(context.access.actor, context.communityId, eventSlug);
  const target =
    event.upcoming.find((occurrence) => occurrence.id === preferredOccurrenceId) ??
    event.upcoming.find((occurrence) => occurrence.canceledAt === null) ??
    event.upcoming[0];
  return target
    ? occurrenceHref(context.slug, event.slug, target.id)
    : calendarHref(context.slug, { month: fallbackMonth });
}

export async function createEventAction(
  raw: CreateEventActionInput,
): Promise<CalendarActionResult<{ href: string }>> {
  return run(createEventSchema, raw, async (input, context) => {
    const event = await calendar().createEvent(context.access.actor, context.communityId, {
      ...toServiceInput(input.values),
      notifyMembers: input.notifyMembers,
    });
    revalidateCalendar(context);
    return { href: await landingHref(context, event.slug, null, input.values.date.slice(0, 7)) };
  });
}

export async function updateEventAction(
  raw: UpdateEventActionInput,
): Promise<CalendarActionResult<{ href: string }>> {
  return run(updateEventSchema, raw, async (input, context) => {
    const event = await calendar().updateEvent(
      context.access.actor,
      context.communityId,
      input.eventSlug,
      toServiceInput(input.values),
    );
    revalidateCalendar(context, { eventSlug: event.slug, occurrenceId: input.occurrenceId });
    return {
      href: await landingHref(
        context,
        event.slug,
        input.occurrenceId,
        input.values.date.slice(0, 7),
      ),
    };
  });
}

export async function previewEventChangeAction(
  raw: PreviewEventChangeInput,
): Promise<CalendarActionResult<EventChangePreview>> {
  return run(previewEventChangeSchema, raw, (input, context) =>
    calendar().previewEventChange(
      context.access.actor,
      context.communityId,
      input.eventSlug,
      toServiceInput(input.values),
    ),
  );
}

export async function previewEventDeleteAction(
  raw: EventRefInput,
): Promise<CalendarActionResult<EventDeletePreview>> {
  return run(deletePreviewSchema, raw, (input, context) =>
    calendar().previewEventDelete(context.access.actor, context.communityId, input.eventSlug),
  );
}

export async function deleteEventAction(
  raw: EventRefInput,
): Promise<CalendarActionResult<{ href: string }>> {
  return run(eventRefSchema, raw, async (input, context) => {
    await calendar().deleteEvent(context.access.actor, context.communityId, input.eventSlug);
    revalidateCalendar(context);
    return { href: calendarHref(context.slug) };
  });
}

export async function setOccurrenceCanceledAction(
  raw: SetCanceledInput,
): Promise<CalendarActionResult<{ canceled: boolean }>> {
  return run(setCanceledSchema, raw, async (input, context) => {
    const service = calendar();
    const args = [context.access.actor, context.communityId, input.occurrenceId] as const;
    const occurrence = input.canceled
      ? await service.cancelOccurrence(...args)
      : await service.uncancelOccurrence(...args);
    revalidateCalendar(context, { eventSlug: occurrence.event.slug, occurrenceId: occurrence.id });
    return { canceled: occurrence.canceledAt !== null };
  });
}

export async function rsvpAction(
  raw: RsvpActionInput,
): Promise<CalendarActionResult<{ status: "going" | "not_going"; goingCount: number }>> {
  return run(rsvpSchema, raw, async (input, context) => {
    const result = await calendar().rsvp(
      context.access.actor,
      context.communityId,
      input.occurrenceId,
      { status: input.status },
    );
    revalidateCalendar(context);
    return { status: result.status, goingCount: result.goingCount };
  });
}

export async function setRecordingAction(
  raw: RecordingActionInput,
): Promise<CalendarActionResult<{ recordingUrl: string | null }>> {
  return run(recordingSchema, raw, async (input, context) => {
    const event = await calendar().setRecordingUrl(
      context.access.actor,
      context.communityId,
      input.eventSlug,
      { recordingUrl: input.recordingUrl || null },
    );
    revalidateCalendar(context);
    return { recordingUrl: event.recordingUrl };
  });
}
