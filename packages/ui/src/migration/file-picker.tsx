"use client";

import { Upload } from "lucide-react";
import { useId, useRef } from "react";

import { Button } from "../primitives/button";

export interface FilePickerProps {
  readonly label: string;
  readonly accept: string;
  readonly disabled?: boolean;
  onFile(file: File): void;
}

export function FilePicker({ label, accept, disabled, onFile }: FilePickerProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" className="size-4" strokeWidth={1.5} />
        {label}
      </Button>
    </div>
  );
}
