"use client";

import { useEffect } from "react";

const unsavedChangesMessage = "You have unsaved changes. Leave this page and lose them?";

function leavesThePage(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  const url = new URL(anchor.href, window.location.href);
  const here = new URL(window.location.href);
  const samePage =
    url.origin === here.origin && url.pathname === here.pathname && url.search === here.search;
  if (samePage && url.hash !== "") return null;
  return anchor;
}

function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    function onClick(event: MouseEvent) {
      if (!leavesThePage(event)) return;
      if (window.confirm(unsavedChangesMessage)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export { unsavedChangesMessage, useUnsavedChanges };
