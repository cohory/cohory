"use client";

import { useEffect, useState } from "react";

import { Field } from "../primitives/field";
import { Textarea } from "../primitives/textarea";
import { jsonSyntaxError, type AgentJsonCheck } from "./agent-types";

interface AgentJsonFieldProps {
  label: string;
  description?: string;
  value: string;
  kind: "schema" | "spec";
  onChange(value: string): void;
  check?: AgentJsonCheck;
  error?: string;
  disabled?: boolean;
  rows?: number;
}

function AgentJsonField({
  label,
  description,
  value,
  kind,
  onChange,
  check,
  error,
  disabled = false,
  rows = 6,
}: AgentJsonFieldProps) {
  const syntax = jsonSyntaxError(value);
  const [remote, setRemote] = useState<{ text: string; message: string | null } | null>(null);

  useEffect(() => {
    if (syntax || !check) return;
    let active = true;
    const timer = setTimeout(() => {
      void check(kind, value).then((message) => {
        if (active) setRemote({ text: value, message });
      });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [check, kind, syntax, value]);

  const live = syntax ?? (remote?.text === value ? remote.message : null);
  const message = live ?? error;
  const valid = !message && remote?.text === value;

  return (
    <Field
      label={label}
      description={valid ? `${description ?? ""} Looks valid.`.trim() : description}
      error={message ?? undefined}
    >
      {(control) => (
        <Textarea
          {...control}
          value={value}
          rows={rows}
          spellCheck={false}
          disabled={disabled}
          className="font-mono text-sm"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export { AgentJsonField, type AgentJsonFieldProps };
