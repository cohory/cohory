"use client";

import { useEffect, useRef, type RefObject } from "react";

function hasErrors(errors: unknown): boolean {
  if (errors === null || errors === undefined) return false;
  if (typeof errors !== "object") return Boolean(errors);
  return Object.values(errors).some(Boolean);
}

function useFocusFirstError<T extends HTMLElement>(errors: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!hasErrors(errors)) return;
    const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
  }, [errors]);

  return ref;
}

export { useFocusFirstError };
