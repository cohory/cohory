"use client";

import { useEffect, useId, useState, type KeyboardEvent, type RefObject } from "react";

import { cn } from "../lib/utils";
import { AuthorAvatar } from "./author-avatar";
import { findMentions } from "./compose-document";
import { resolveMentions, type MentionResolver } from "./resolve-mentions";

interface MentionSuggestion {
  userId: string;
  label: string;
  avatarUrl?: string | null;
}

interface MentionQuery {
  start: number;
  query: string;
}

const QUERY_BEFORE_CARET = /(^|[^\w@])@([\p{L}\p{N}_.-]{1,32})$/u;

function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const match = QUERY_BEFORE_CARET.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

function mentionToken(label: string): string | null {
  const token = label.replace(/[^A-Za-z0-9_]/g, "");
  return token === "" ? null : token;
}

function insertMention(
  text: string,
  at: MentionQuery,
  label: string,
): { text: string; caret: number } | null {
  const token = mentionToken(label);
  if (!token) return null;
  const inserted = `@${token} `;
  const end = at.start + 1 + at.query.length;
  return {
    text: text.slice(0, at.start) + inserted + text.slice(end).replace(/^ /, ""),
    caret: at.start + inserted.length,
  };
}

interface MentionSuggestionsProps {
  id: string;
  suggestions: readonly MentionSuggestion[];
  activeIndex: number;
  onPick(suggestion: MentionSuggestion): void;
}

function mentionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

function MentionSuggestions({ id, suggestions, activeIndex, onPick }: MentionSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Mention a member"
      data-slot="mention-suggestions"
      className="absolute inset-x-0 top-full z-(--z-raised) mt-1 flex max-h-64 flex-col overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-(--card-shadow)"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.userId}
          id={mentionOptionId(id, index)}
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(suggestion);
          }}
          className={cn(
            "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-text",
            index === activeIndex ? "bg-surface-hover" : "hover:bg-surface-hover",
          )}
        >
          <AuthorAvatar
            name={suggestion.label}
            avatarUrl={suggestion.avatarUrl}
            className="size-6"
          />
          <span className="truncate">{suggestion.label}</span>
        </li>
      ))}
    </ul>
  );
}

type MentionSearch = (query: string) => Promise<readonly MentionSuggestion[]>;

interface Found {
  query: string;
  items: readonly MentionSuggestion[];
}

const SEARCH_DELAY_MS = 150;
const RESOLVE_DELAY_MS = 400;

function useMentionAutocomplete(options: {
  text: string;
  setText(text: string): void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSearch?: MentionSearch;
}) {
  const { text, setText, textareaRef, onSearch } = options;
  const listId = useId();
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(0);
  const needle = query?.query ?? null;

  useEffect(() => {
    if (!onSearch || needle === null) return;
    let live = true;
    const timer = setTimeout(() => {
      onSearch(needle).then(
        (items) => {
          if (!live) return;
          setFound({ query: needle, items: items.filter((item) => mentionToken(item.label)) });
          setActive(0);
        },
        () => {
          if (live) setFound(null);
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [onSearch, needle]);

  const suggestions = found && found.query === needle ? found.items : [];
  const open = query !== null && suggestions.length > 0;

  function track(value: string, caret: number) {
    setQuery(activeMentionQuery(value, caret));
  }

  function pick(suggestion: MentionSuggestion) {
    if (!query) return;
    const next = insertMention(text, query, suggestion.label);
    if (!next) return;
    setText(next.text);
    setQuery(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const choice = suggestions[active];
      if (choice) pick(choice);
    } else if (event.key === "Escape") {
      setQuery(null);
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    open,
    track,
    onKeyDown,
    close: () => setQuery(null),
    list: { id: listId, suggestions: open ? suggestions : [], activeIndex: active, onPick: pick },
    textareaProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? mentionOptionId(listId, active) : undefined,
    },
  };
}

function useUnresolvedMentions(text: string, resolver: MentionResolver | undefined): string[] {
  const [unresolved, setUnresolved] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!resolver) return;
    let live = true;
    const timer = setTimeout(() => {
      resolveMentions(text, resolver).then(
        (resolve) => {
          if (live) setUnresolved(findMentions(text).filter((name) => resolve(name) === null));
        },
        () => undefined,
      );
    }, RESOLVE_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, resolver]);

  const present = new Set(findMentions(text));
  return unresolved.filter((name) => present.has(name));
}

export {
  activeMentionQuery,
  insertMention,
  mentionOptionId,
  MentionSuggestions,
  mentionToken,
  useMentionAutocomplete,
  useUnresolvedMentions,
  type MentionSearch,
  type MentionQuery,
  type MentionSuggestion,
};
