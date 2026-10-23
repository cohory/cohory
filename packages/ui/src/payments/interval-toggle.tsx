"use client";

import { useId } from "react";

import { cn } from "../lib/utils";
import type { BillingInterval } from "./money";

interface IntervalToggleProps {
  value: BillingInterval;
  onChange(interval: BillingInterval): void;
  disabled?: boolean;
  className?: string;
}

const options: readonly { value: BillingInterval; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

function IntervalToggle({ value, onChange, disabled = false, className }: IntervalToggleProps) {
  const name = useId();
  return (
    <fieldset
      data-slot="interval-toggle"
      disabled={disabled}
      className={cn("inline-flex rounded-md border border-border bg-surface p-1", className)}
    >
      <legend className="sr-only">Billing period</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "relative inline-flex min-h-9 cursor-pointer items-center rounded-sm px-3 text-sm font-medium text-text-muted transition-colors duration-(--duration-fast) ease-(--ease-standard) has-checked:bg-accent-muted has-checked:text-text has-focus-visible:ring-2 has-focus-visible:ring-ring motion-reduce:transition-none",
            disabled && "cursor-not-allowed",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

export { IntervalToggle, type IntervalToggleProps };
