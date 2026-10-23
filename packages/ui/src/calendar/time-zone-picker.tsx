"use client";

import { CheckIcon } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { Input } from "../primitives/input";
import { cn } from "../lib/utils";
import { timeZoneOption, type TimeZoneOption } from "./time-zones";

const maxShown = 60;

interface TimeZonePickerProps {
  id: string;
  value: string;
  zones: readonly string[];
  onChange(zone: string): void;
  at: Date;
  recent?: readonly string[];
  disabled?: boolean;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

function rank(
  options: TimeZoneOption[],
  query: string,
  first: readonly string[],
): TimeZoneOption[] {
  const needle = query.trim().toLowerCase();
  if (needle) {
    return options.filter((option) => option.search.includes(needle)).slice(0, maxShown);
  }
  const pinned = first.flatMap((zone) => options.filter((option) => option.value === zone));
  const common = options.filter((option) => option.common && !first.includes(option.value));
  return [...pinned, ...common];
}

function TimeZonePicker({
  id,
  value,
  zones,
  onChange,
  at,
  recent = [],
  disabled = false,
  ...aria
}: TimeZonePickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    const all = zones.includes(value) ? zones : [value, ...zones];
    return all.map((zone) => timeZoneOption(zone, at));
  }, [zones, value, at]);
  const selected = options.find((option) => option.value === value);
  const shown = useMemo(
    () => rank(options, query, [...new Set([value, ...recent])]),
    [options, query, value, recent],
  );

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  function choose(option: TimeZoneOption | undefined) {
    if (option) onChange(option.value);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => Math.min(Math.max(current + step, 0), Math.max(shown.length - 1, 0)));
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(shown[active]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      <Input
        {...aria}
        id={id}
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search by city or country"
        disabled={disabled}
        value={open ? query : (selected?.label ?? value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Time zones"
          className="absolute z-(--z-popover) mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-(--card-shadow)"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">No time zone matches.</li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm text-text",
                  index === active && "bg-surface-hover",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.label}
                {option.value === value ? (
                  <CheckIcon aria-hidden="true" className="size-4 text-text-muted" />
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export { TimeZonePicker, type TimeZonePickerProps };
