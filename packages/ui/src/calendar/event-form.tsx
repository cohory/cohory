"use client";

import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "../primitives/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { Select } from "../primitives/select";
import { Switch } from "../primitives/switch";
import { Textarea } from "../primitives/textarea";
import { useFocusFirstError } from "../lib/use-focus-first-error";
import { cn } from "../lib/utils";
import { EventCoverField } from "./event-cover-field";
import { scheduleSummary, zoneChange } from "./schedule-summary";
import { formatDuration } from "./time";
import { TimeZonePicker } from "./time-zone-picker";
import type { EventRecurrence } from "./types";

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120] as const;
const CUSTOM = "custom";

interface EventFormValue {
  title: string;
  description: string;
  date: string;
  time: string;
  timeZone: string;
  durationMinutes: number;
  recurrence: EventRecurrence | null;
  recurrenceUntil: string;
  location: string;
  coverKey: string | null;
  coverUrl: string | null;
}

type EventFormErrors = Partial<Record<keyof EventFormValue | "form", string>>;

interface EventFormCover {
  onFile(file: File): void;
  uploading?: boolean;
  error?: string;
}

interface EventFormNotify {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}

interface EventFormProps {
  value: EventFormValue;
  onChange(value: EventFormValue): void;
  onSubmit(): void;
  timeZones: string[];
  submitLabel: string;
  viewerTimeZone?: string;
  baseline?: Pick<EventFormValue, "date" | "time" | "timeZone">;
  cover?: EventFormCover;
  notify?: EventFormNotify;
  errors?: EventFormErrors;
  pending?: boolean;
  notice?: string;
  className?: string;
}

function isPreset(minutes: number): boolean {
  return DURATION_PRESETS.some((preset) => preset === minutes);
}

function zoneDate(date: string): Date {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date("2026-01-15T12:00:00Z") : parsed;
}

function EventForm({
  value,
  onChange,
  onSubmit,
  timeZones,
  submitLabel,
  viewerTimeZone,
  baseline,
  cover,
  notify,
  errors = {},
  pending = false,
  notice,
  className,
}: EventFormProps) {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const formRef = useFocusFirstError<HTMLFormElement>(errors);
  const recurrenceId = useId();
  const notifyId = useId();
  const [customDuration, setCustomDuration] = useState(() => !isPreset(value.durationMinutes));
  const [moreOpen, setMoreOpen] = useState(
    () => value.description.trim() !== "" || value.recurrence !== null || value.coverKey !== null,
  );
  const hiddenError = Boolean(errors.description ?? errors.recurrenceUntil ?? errors.coverKey);
  const zoneAt = useMemo(() => zoneDate(value.date), [value.date]);
  const recentZones = useMemo(() => (viewerTimeZone ? [viewerTimeZone] : []), [viewerTimeZone]);
  const summary = scheduleSummary(value, viewerTimeZone);
  const change = baseline ? zoneChange(baseline, value.timeZone) : null;

  function update(patch: Partial<EventFormValue>) {
    onChange({ ...latest.current, ...patch });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  const keeps = (target: { date: string; time: string }) =>
    value.date === target.date && value.time === target.time;

  return (
    <form
      ref={formRef}
      noValidate
      data-slot="event-form"
      aria-busy={pending || undefined}
      onSubmit={submit}
      className={cn("flex flex-col gap-6", className)}
    >
      <Field label="Title" error={errors.title}>
        {(control) => (
          <Input
            {...control}
            value={value.title}
            maxLength={200}
            required
            disabled={pending}
            onChange={(event) => update({ title: event.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Date" error={errors.date}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={value.date}
              required
              disabled={pending}
              onChange={(event) => update({ date: event.target.value })}
            />
          )}
        </Field>
        <Field label="Start time" error={errors.time}>
          {(control) => (
            <Input
              {...control}
              type="time"
              value={value.time}
              required
              disabled={pending}
              onChange={(event) => update({ time: event.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Time zone" error={errors.timeZone}>
          {(control) => (
            <TimeZonePicker
              {...control}
              value={value.timeZone}
              zones={timeZones}
              recent={recentZones}
              at={zoneAt}
              disabled={pending}
              onChange={(timeZone) => update({ timeZone })}
            />
          )}
        </Field>
        <div className="flex flex-col gap-4">
          <Field label="Duration" error={customDuration ? undefined : errors.durationMinutes}>
            {(control) => (
              <Select
                {...control}
                value={customDuration ? CUSTOM : String(value.durationMinutes)}
                disabled={pending}
                onChange={(event) => {
                  if (event.target.value === CUSTOM) {
                    setCustomDuration(true);
                    return;
                  }
                  setCustomDuration(false);
                  update({ durationMinutes: Number(event.target.value) });
                }}
              >
                {DURATION_PRESETS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatDuration(minutes)}
                  </option>
                ))}
                <option value={CUSTOM}>Custom</option>
              </Select>
            )}
          </Field>
          {customDuration ? (
            <Field label="Duration in minutes" error={errors.durationMinutes}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={1440}
                  step={5}
                  value={Number.isFinite(value.durationMinutes) ? value.durationMinutes : ""}
                  disabled={pending}
                  onChange={(event) => update({ durationMinutes: event.target.valueAsNumber })}
                />
              )}
            </Field>
          ) : null}
        </div>
      </div>
      {summary ? (
        <p
          data-slot="event-schedule-summary"
          aria-live="polite"
          className="text-sm text-text-muted"
        >
          {summary}
        </p>
      ) : null}
      {change && (keeps(change.keepClock.value) || keeps(change.keepMoment.value)) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-text">
            The time zone changed. What should stay the same?
          </legend>
          {[change.keepClock, change.keepMoment].map((choice) => (
            <label key={choice.label} className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name="zone-change"
                checked={keeps(choice.value)}
                disabled={pending}
                onChange={() => update(choice.value)}
                className="size-4 accent-accent"
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field
        label="Location"
        description="Paste a meeting link or write an address."
        error={errors.location}
      >
        {(control) => (
          <Input
            {...control}
            value={value.location}
            maxLength={500}
            disabled={pending}
            onChange={(event) => update({ location: event.target.value })}
          />
        )}
      </Field>
      <Collapsible open={moreOpen || hiddenError} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
          More options
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-6 pt-4">
          <Field label="Description" error={errors.description}>
            {(control) => (
              <Textarea
                {...control}
                value={value.description}
                rows={6}
                maxLength={5000}
                disabled={pending}
                onChange={(event) => update({ description: event.target.value })}
              />
            )}
          </Field>
          {cover ? (
            <EventCoverField
              coverUrl={value.coverUrl}
              onFile={cover.onFile}
              onRemove={() => update({ coverKey: null, coverUrl: null })}
              uploading={cover.uploading}
              error={cover.error ?? errors.coverKey}
              disabled={pending}
            />
          ) : null}
          <div className="flex items-center gap-3">
            <Switch
              id={recurrenceId}
              checked={value.recurrence === "weekly"}
              disabled={pending}
              onCheckedChange={(checked) =>
                update(
                  checked ? { recurrence: "weekly" } : { recurrence: null, recurrenceUntil: "" },
                )
              }
            />
            <Label htmlFor={recurrenceId}>Repeats weekly</Label>
          </div>
          {value.recurrence === "weekly" ? (
            <Field
              label="Ends on"
              description="Leave empty to keep repeating."
              error={errors.recurrenceUntil}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  min={value.date || undefined}
                  value={value.recurrenceUntil}
                  disabled={pending}
                  onChange={(event) => update({ recurrenceUntil: event.target.value })}
                />
              )}
            </Field>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
      {notify ? (
        <div className="flex items-start gap-3">
          <Switch
            id={notifyId}
            checked={notify.checked}
            disabled={pending}
            onCheckedChange={notify.onCheckedChange}
            aria-describedby={`${notifyId}-description`}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={notifyId}>Tell members about this event</Label>
            <p id={`${notifyId}-description`} className="text-sm text-text-muted">
              Members get a notice in the app. Those who turned on email for new events get an email
              too.
            </p>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-text">
          {notice}
        </p>
      ) : null}
      {errors.form ? (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? (
            <Loader2Icon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export {
  DURATION_PRESETS,
  EventForm,
  type EventFormCover,
  type EventFormErrors,
  type EventFormNotify,
  type EventFormProps,
  type EventFormValue,
};
