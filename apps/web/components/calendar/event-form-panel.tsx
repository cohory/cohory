"use client";

import { Button, EventForm, toast, type EventFormErrors, type EventFormValue } from "@cohory/ui";
import { draftKey, draftSavedTime, useDraftAutosave } from "@cohory/ui/lib/use-draft-autosave";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  createEventAction,
  previewEventChangeAction,
  updateEventAction,
} from "../../lib/calendar/actions";
import { uploadPostImage } from "../feed/client-helpers";

type Mode = { kind: "create" } | { kind: "edit"; eventSlug: string; occurrenceId: string };

interface Preview {
  readonly moving: number;
  readonly removing: number;
}

const saveFailed = "We couldn't save your changes. Check your connection and try again.";
const previewDelayMs = 400;

const draftSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.string(),
  time: z.string(),
  timeZone: z.string(),
  durationMinutes: z.number(),
  recurrence: z.enum(["weekly"]).nullable(),
  recurrenceUntil: z.string(),
  location: z.string(),
  coverKey: z.string().nullable(),
  coverUrl: z.string().nullable(),
});

function parseDraft(raw: unknown): EventFormValue | null {
  const parsed = draftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function eventDraftKey(slug: string, mode: Mode): string {
  return draftKey("event", mode.kind === "create" ? `${slug}:new` : `${slug}:${mode.eventSlug}`);
}

function sameValue(a: EventFormValue, b: EventFormValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function scheduleChanged(value: EventFormValue, initial: EventFormValue): boolean {
  return (
    value.date !== initial.date ||
    value.time !== initial.time ||
    value.timeZone !== initial.timeZone ||
    value.recurrence !== initial.recurrence ||
    value.recurrenceUntil !== initial.recurrenceUntil
  );
}

function people(count: number): string {
  return count === 1 ? "1 person is going" : `${count} people are going`;
}

function previewNotice({ moving, removing }: Preview): string | undefined {
  const lines = [
    moving > 0 ? `${people(moving)}. We'll email them the new time.` : null,
    removing > 0 ? `${people(removing)} to dates that will be removed. We'll tell them.` : null,
  ].filter((line) => line !== null);
  return lines.length > 0 ? lines.join(" ") : undefined;
}

function usePreview(slug: string, mode: Mode, value: EventFormValue, initial: EventFormValue) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const changed = mode.kind === "edit" && scheduleChanged(value, initial);
  const eventSlug = mode.kind === "edit" ? mode.eventSlug : null;

  useEffect(() => {
    if (!changed || !eventSlug) return;
    let current = true;
    const timer = setTimeout(() => {
      previewEventChangeAction({ slug, eventSlug, values: value })
        .then((result) => {
          if (current) setPreview(result.ok ? result.data : null);
        })
        .catch(() => {
          if (current) setPreview(null);
        });
    }, previewDelayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [changed, eventSlug, slug, value]);

  return changed && preview ? previewNotice(preview) : undefined;
}

function announceCreated(href: string): void {
  toast("Event created.", {
    action: {
      label: "Copy link",
      onClick: () => {
        const url = new URL(href, window.location.origin).toString();
        navigator.clipboard.writeText(url).then(
          () => toast("Link copied."),
          () => toast.error("We couldn't copy the link."),
        );
      },
    },
  });
}

export function EventFormPanel({
  slug,
  mode,
  initial,
  timeZones,
  viewerTimeZone,
}: {
  slug: string;
  mode: Mode;
  initial: EventFormValue;
  timeZones: string[];
  viewerTimeZone?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [pending, setPending] = useState(false);
  const [notifyMembers, setNotifyMembers] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | undefined>();
  const notice = usePreview(slug, mode, value, initial);
  const dirty = !sameValue(value, initial);
  const draft = useDraftAutosave(eventDraftKey(slug, mode), value, { dirty, parse: parseDraft });
  useUnsavedChanges(dirty && !pending);

  async function uploadCover(file: File) {
    setUploading(true);
    setCoverError(undefined);
    try {
      const uploaded = await uploadPostImage(slug, file);
      setValue((current) => ({ ...current, coverKey: uploaded.key, coverUrl: uploaded.url }));
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "The image didn't upload.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setPending(true);
    let leaving = false;
    try {
      const result =
        mode.kind === "create"
          ? await createEventAction({ slug, values: value, notifyMembers })
          : await updateEventAction({
              slug,
              eventSlug: mode.eventSlug,
              occurrenceId: mode.occurrenceId,
              values: value,
            });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { form: result.message });
        return;
      }
      setErrors({});
      leaving = true;
      draft.clear();
      if (mode.kind === "create") announceCreated(result.data.href);
      router.push(result.data.href);
    } catch {
      setErrors({ form: saveFailed });
    } finally {
      if (!leaving) setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {draft.restore ? (
        <div
          role="group"
          aria-label="Unsaved changes on this device"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-hover p-3 text-sm"
        >
          <span className="text-text">
            You have unsaved changes from {draftSavedTime(draft.restore.savedAt)}.
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const restored = draft.restore?.value;
                draft.clear();
                if (restored) setValue(restored);
              }}
            >
              Restore changes
            </Button>
            <Button type="button" variant="ghost" onClick={draft.clear}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      <EventForm
        value={value}
        onChange={setValue}
        onSubmit={() => void submit()}
        timeZones={timeZones}
        viewerTimeZone={viewerTimeZone}
        baseline={mode.kind === "edit" ? initial : undefined}
        cover={{ onFile: (file) => void uploadCover(file), uploading, error: coverError }}
        notify={
          mode.kind === "create"
            ? { checked: notifyMembers, onCheckedChange: setNotifyMembers }
            : undefined
        }
        submitLabel={mode.kind === "create" ? "Create event" : "Save changes"}
        errors={errors}
        pending={pending}
        notice={notice}
      />
    </div>
  );
}
