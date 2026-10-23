"use client";

import { useId, useRef } from "react";

import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { localInputValue, schedulePresets, timeZoneLabel } from "./schedule";

interface ComposerScheduleProps {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  onPostNow?(): void;
  now?: Date;
}

function ComposerSchedule({ value, onChange, disabled, onPostNow, now }: ComposerScheduleProps) {
  const fieldId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const current = now ?? new Date();
  const presets = schedulePresets(current);

  return (
    <div data-slot="composer-schedule" className="flex flex-col gap-2">
      <div role="group" aria-label="Pick a time" className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-pressed={value === presets.tomorrow}
          onClick={() => onChange(presets.tomorrow)}
        >
          Tomorrow 09:00
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-pressed={value === presets.monday}
          onClick={() => onChange(presets.monday)}
        >
          Monday 09:00
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.focus()}
        >
          Custom
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={fieldId} className="text-sm text-text-muted">
          Publish on
        </label>
        <Input
          ref={inputRef}
          id={fieldId}
          type="datetime-local"
          value={value}
          min={localInputValue(current)}
          readOnly={disabled}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="w-auto"
        />
        <span id={hintId} className="text-xs text-text-muted">
          Your time zone: {timeZoneLabel()}
        </span>
        {onPostNow ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onPostNow}>
            Post now instead
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export { ComposerSchedule, type ComposerScheduleProps };
