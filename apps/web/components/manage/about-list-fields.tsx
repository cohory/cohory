"use client";

import { Button, Field, Input, Textarea } from "@cohory/ui";
import { Plus, X } from "lucide-react";

export interface FaqDraft {
  readonly q: string;
  readonly a: string;
}

export const starterQuestions = [
  "Who is this for?",
  "How much time does it take each week?",
  "How do refunds work?",
  "How do I cancel?",
] as const;

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, at) => (at === index ? value : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, at) => at !== index);
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      className="size-11 shrink-0 px-0"
      onClick={onClick}
    >
      <X aria-hidden="true" className="size-5" strokeWidth={1.5} />
    </Button>
  );
}

export function WhatYouGetFields({
  lines,
  max,
  maxLength,
  onChange,
}: {
  lines: readonly string[];
  max: number;
  maxLength: number;
  onChange: (lines: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-text">What you get</legend>
      <p className="text-sm text-text-muted">
        Up to {max} short lines, shown with a check mark. Leave it empty and visitors see what the
        community has today, such as the number of courses.
      </p>
      {lines.map((line, index) => (
        <div key={index} className="flex items-end gap-2">
          <Field label={`Line ${index + 1}`} className="min-w-0 flex-1">
            {(control) => (
              <Input
                {...control}
                value={line}
                maxLength={maxLength}
                onChange={(event) => onChange(replaceAt(lines, index, event.target.value))}
              />
            )}
          </Field>
          <RemoveButton
            label={`Remove line ${index + 1}`}
            onClick={() => onChange(removeAt(lines, index))}
          />
        </div>
      ))}
      {lines.length < max ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-start"
          onClick={() => onChange([...lines, ""])}
        >
          <Plus aria-hidden="true" className="size-5" strokeWidth={1.5} />
          Add a line
        </Button>
      ) : null}
    </fieldset>
  );
}

export function FaqFields({
  items,
  max,
  questionMax,
  answerMax,
  onChange,
}: {
  items: readonly FaqDraft[];
  max: number;
  questionMax: number;
  answerMax: number;
  onChange: (items: FaqDraft[]) => void;
}) {
  const asked = new Set(items.map((item) => item.q.trim()));
  const suggestions = starterQuestions.filter((question) => !asked.has(question));
  const room = items.length < max;
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-sm font-medium text-text">Questions</legend>
      <p className="text-sm text-text-muted">
        Answer what people ask before they join. Up to {max} questions.
      </p>
      {items.map((item, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-end gap-2">
            <Field label={`Question ${index + 1}`} className="min-w-0 flex-1">
              {(control) => (
                <Input
                  {...control}
                  value={item.q}
                  maxLength={questionMax}
                  onChange={(event) =>
                    onChange(replaceAt(items, index, { ...item, q: event.target.value }))
                  }
                />
              )}
            </Field>
            <RemoveButton
              label={`Remove question ${index + 1}`}
              onClick={() => onChange(removeAt(items, index))}
            />
          </div>
          <Field label={`Answer ${index + 1}`}>
            {(control) => (
              <Textarea
                {...control}
                value={item.a}
                maxLength={answerMax}
                rows={3}
                onChange={(event) =>
                  onChange(replaceAt(items, index, { ...item, a: event.target.value }))
                }
              />
            )}
          </Field>
        </div>
      ))}
      {room ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => onChange([...items, { q: "", a: "" }])}
          >
            <Plus aria-hidden="true" className="size-5" strokeWidth={1.5} />
            Add a question
          </Button>
          {suggestions.map((question) => (
            <Button
              key={question}
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => onChange([...items, { q: question, a: "" }])}
            >
              <Plus aria-hidden="true" className="size-5" strokeWidth={1.5} />
              {question}
            </Button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
