"use client";

import { Info } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "../lib/utils";
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type FieldControlProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

type FieldProps = {
  label: ReactNode;
  description?: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

function FieldHint({ id, label, hint }: { id: string; label: ReactNode; hint: string }) {
  return (
    <>
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={typeof label === "string" ? `About ${label}` : "More information"}
          className="touch-hit relative -m-1.5 inline-flex size-7 items-center justify-center rounded-full text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info aria-hidden className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="start" className="text-sm">
          {hint}
        </PopoverContent>
      </Popover>
      <p id={id} className="sr-only">
        {hint}
      </p>
    </>
  );
}

function Field({ label, description, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, descriptionId, errorId].filter(Boolean).join(" ");

  return (
    <div data-slot="field" className={cn("flex flex-col gap-2", className)}>
      {hintId && hint ? (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <FieldHint id={hintId} label={label} hint={hint} />
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      {children({
        id,
        ...(error ? { "aria-invalid": true } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {description ? (
        <p id={descriptionId} className="text-sm text-text-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Field, type FieldControlProps, type FieldProps };
