"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { formatDateTime } from "./format-date";

interface DraftAutosaveOptions<T> {
  dirty: boolean;
  parse(raw: unknown): T | null;
  intervalMs?: number;
}

interface StoredDraft<T> {
  value: T;
  savedAt: Date;
}

interface DraftAutosave<T> {
  restore: StoredDraft<T> | null;
  savedAt: Date | null;
  clear(): void;
}

const draftPrefix = "cohory:draft:";

function draftKey(kind: string, id: string): string {
  return `${draftPrefix}${kind}:${id}`;
}

function clearAllDrafts(): void {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(draftPrefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    return;
  }
}

function readDraft<T>(key: string, parse: (raw: unknown) => T | null): StoredDraft<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return null;
    if (!("savedAt" in stored) || !("value" in stored)) return null;
    if (typeof stored.savedAt !== "string") return null;
    const savedAt = new Date(stored.savedAt);
    const value = parse(stored.value);
    if (Number.isNaN(savedAt.getTime()) || value === null) return null;
    return { value, savedAt };
  } catch {
    return null;
  }
}

function writeDraft(key: string, value: unknown, savedAt: Date): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: savedAt.toISOString(), value }));
    return true;
  } catch {
    return false;
  }
}

function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}

function useDraftAutosave<T>(
  key: string | null,
  value: T,
  { dirty, parse, intervalMs = 3000 }: DraftAutosaveOptions<T>,
): DraftAutosave<T> {
  const [restore, setRestore] = useState<StoredDraft<T> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const initial = useRef(value);
  const touched = useRef(false);
  const pending = useRef<{ key: string; value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const parseRef = useRef(parse);
  useLayoutEffect(() => {
    parseRef.current = parse;
  });

  useEffect(() => {
    if (key === null) return;
    setRestore(readDraft(key, parseRef.current));
  }, [key]);

  useEffect(() => {
    if (!Object.is(value, initial.current)) touched.current = true;
    if (key === null || !touched.current) return;
    if (!dirty) {
      pending.current = null;
      removeDraft(key);
      return;
    }
    pending.current = { key, value };
    timer.current = window.setTimeout(() => {
      pending.current = null;
      const now = new Date();
      if (writeDraft(key, value, now)) setSavedAt(now);
    }, intervalMs);
    return () => window.clearTimeout(timer.current);
  }, [key, value, dirty, intervalMs]);

  useEffect(
    () => () => {
      const last = pending.current;
      if (last) writeDraft(last.key, last.value, new Date());
    },
    [],
  );

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = null;
    initial.current = value;
    touched.current = false;
    setRestore(null);
    setSavedAt(null);
    if (key !== null) removeDraft(key);
  }, [key, value]);

  return { restore, savedAt, clear };
}

function draftSavedTime(savedAt: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatDateTime(savedAt, { timeZone });
}

export {
  clearAllDrafts,
  draftKey,
  draftSavedTime,
  useDraftAutosave,
  type DraftAutosave,
  type DraftAutosaveOptions,
  type StoredDraft,
};
