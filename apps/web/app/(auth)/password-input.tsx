"use client";

import { cn, Input } from "@cohory/ui";
import { useState, type ComponentProps } from "react";

export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-16", className)} />
      <button
        type="button"
        aria-label="Show password"
        aria-pressed={visible}
        onClick={() => setVisible((shown) => !shown)}
        className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-md px-3 text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Show
      </button>
    </div>
  );
}
