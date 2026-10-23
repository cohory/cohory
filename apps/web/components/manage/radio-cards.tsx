"use client";

import { cn } from "@cohory/ui/lib/utils";
import { useId, type ReactNode } from "react";

export interface RadioCardOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}

export function RadioCards<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  columns = 3,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly RadioCardOption<NoInfer<T>>[];
  onChange(value: NoInfer<T>): void;
  columns?: 2 | 3;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      <div className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                "flex min-h-11 flex-col gap-1 rounded-md border p-3 focus-within:ring-2 focus-within:ring-ring",
                option.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                checked
                  ? "border-accent bg-accent-muted"
                  : "border-border bg-surface hover:bg-surface-hover",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                <input
                  id={optionId}
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => onChange(option.value)}
                  className="size-4 accent-(--color-accent)"
                />
                {option.label}
              </span>
              {option.description ? (
                <span className={cn("text-sm", checked ? "text-text" : "text-text-muted")}>
                  {option.description}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
