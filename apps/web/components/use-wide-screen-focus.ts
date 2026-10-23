"use client";

import { useCallback } from "react";

const wideScreenWithPointer = "(min-width: 768px) and (pointer: fine)";

export function useWideScreenFocus<T extends HTMLElement>(): (element: T | null) => void {
  return useCallback((element: T | null) => {
    if (!element || typeof window.matchMedia !== "function") return;
    if (window.matchMedia(wideScreenWithPointer).matches) element.focus();
  }, []);
}
