"use client";

import { CalendarDaysIcon, ListIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";

type CalendarView = "month" | "list";

interface CalendarViewSwitchProps {
  view: CalendarView;
  onChange(view: CalendarView): void;
  className?: string;
}

const options: { value: CalendarView; label: string; icon: ReactNode }[] = [
  {
    value: "month",
    label: "Month",
    icon: <CalendarDaysIcon className="mr-1.5 size-4" aria-hidden="true" />,
  },
  { value: "list", label: "List", icon: <ListIcon className="mr-1.5 size-4" aria-hidden="true" /> },
];

function CalendarViewSwitch({ view, onChange, className }: CalendarViewSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Calendar view"
      data-slot="calendar-view-switch"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md border border-border bg-surface-hover p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === view;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-state={active ? "active" : "inactive"}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            className="inline-flex h-8 items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap text-text-muted transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm"
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { CalendarViewSwitch, type CalendarView, type CalendarViewSwitchProps };
