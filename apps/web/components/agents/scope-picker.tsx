"use client";

import {
  defaultScopes,
  scopeDescription,
  scopeDetails,
  scopes,
  type Scope,
  type ScopeAccess,
  type ScopeAudience,
} from "@cohory/authz";
import { useId, useState } from "react";

const groups: readonly { access: ScopeAccess; title: string }[] = [
  { access: "read", title: "Read" },
  { access: "write", title: "Write" },
  { access: "sensitive", title: "Sensitive" },
];

type PresetId = "read" | "drafts" | "moderation" | "custom";

interface Preset {
  readonly id: Exclude<PresetId, "custom">;
  readonly label: string;
  readonly scopes: readonly Scope[];
}

const presetDefinitions: readonly Preset[] = [
  { id: "read", label: "Read only", scopes: defaultScopes },
  {
    id: "drafts",
    label: "Write drafts",
    scopes: [...defaultScopes, "posts:write", "comments:write"],
  },
  {
    id: "moderation",
    label: "Moderation helper",
    scopes: [...defaultScopes, "members:read", "members:moderate", "proposals:write"],
  },
];

export function presetsFor(available: readonly Scope[]): Preset[] {
  return presetDefinitions
    .filter((preset) => preset.id !== "moderation" || available.includes("members:moderate"))
    .map((preset) => ({
      ...preset,
      scopes: scopes.filter((scope) => preset.scopes.includes(scope) && available.includes(scope)),
    }))
    .filter(
      (preset, index, all) =>
        preset.scopes.length > 0 &&
        all.findIndex((other) => sameScopes(other.scopes, preset.scopes)) === index,
    );
}

function sameScopes(a: readonly Scope[], b: readonly Scope[]): boolean {
  return a.length === b.length && a.every((scope) => b.includes(scope));
}

function ScopeOption({
  scope,
  idPrefix,
  checked,
  audience,
  onToggle,
}: {
  scope: Scope;
  idPrefix: string;
  checked: boolean;
  audience: ScopeAudience;
  onToggle(scope: Scope, checked: boolean): void;
}) {
  const id = `${idPrefix}-${scope.replace(":", "-")}`;
  return (
    <li className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(scope, event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-accent"
        aria-describedby={`${id}-description`}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm text-text">
          {scopeDetails[scope].label}
          <code aria-hidden="true" className="ml-2 font-mono text-xs text-text-muted">
            {scope}
          </code>
        </label>
        <span id={`${id}-description`} className="text-sm text-text-muted">
          {scopeDescription(scope, audience)}
        </span>
      </div>
    </li>
  );
}

function ScopeGroups({
  list,
  ...option
}: {
  list: readonly Scope[];
  idPrefix: string;
  value: readonly Scope[];
  audience: ScopeAudience;
  onToggle(scope: Scope, checked: boolean): void;
}) {
  return groups.map((group) => {
    const inGroup = list.filter((scope) => scopeDetails[scope].access === group.access);
    if (inGroup.length === 0) return null;
    return (
      <div key={group.access} className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{group.title}</p>
        <ul className="flex flex-col gap-2">
          {inGroup.map((scope) => (
            <ScopeOption
              key={scope}
              scope={scope}
              idPrefix={option.idPrefix}
              audience={option.audience}
              checked={option.value.includes(scope)}
              onToggle={option.onToggle}
            />
          ))}
        </ul>
      </div>
    );
  });
}

export function ScopePicker({
  value,
  onChange,
  idPrefix,
  available,
  audience = "staff",
  limited = true,
}: {
  value: readonly Scope[];
  onChange(next: Scope[]): void;
  idPrefix: string;
  available: readonly Scope[];
  audience?: ScopeAudience;
  limited?: boolean;
}) {
  const presetName = useId();
  const presets = presetsFor(available);
  const matching = presets.find((preset) => sameScopes(preset.scopes, value))?.id ?? "custom";
  const [custom, setCustom] = useState(false);
  const selected: PresetId = custom ? "custom" : matching;
  const offered = scopes.filter((scope) => available.includes(scope));
  const common = offered.filter((scope) => scopeDetails[scope].roles.includes("member"));
  const more = offered.filter((scope) => !common.includes(scope));
  const [moreOpen, setMoreOpen] = useState(() => more.some((scope) => value.includes(scope)));

  function toggle(scope: Scope, checked: boolean) {
    const next = checked ? [...value, scope] : value.filter((item) => item !== scope);
    setCustom(true);
    onChange(scopes.filter((item) => next.includes(item) && available.includes(item)));
  }

  function choose(id: PresetId) {
    if (id === "custom") {
      setCustom(true);
      return;
    }
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setCustom(false);
    setMoreOpen(more.some((scope) => preset.scopes.includes(scope)));
    onChange([...preset.scopes]);
  }

  const shared = { idPrefix, value, audience, onToggle: toggle };

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-medium text-text">Permissions</legend>
      {presets.length > 1 ? (
        <div role="radiogroup" aria-label="Start from" className="flex flex-wrap gap-2">
          {[...presets, { id: "custom" as const, label: "Custom" }].map((preset) => (
            <label
              key={preset.id}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-text has-[:checked]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name={presetName}
                value={preset.id}
                checked={selected === preset.id}
                onChange={() => choose(preset.id)}
                className="size-4 accent-accent"
              />
              {preset.label}
            </label>
          ))}
        </div>
      ) : null}
      <ScopeGroups list={common} {...shared} />
      {more.length > 0 ? (
        <details
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          className="flex flex-col gap-4"
        >
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
            More permissions ({more.length})
          </summary>
          <div className="mt-2 flex flex-col gap-4">
            <ScopeGroups list={more} {...shared} />
          </div>
        </details>
      ) : null}
      {limited && offered.length < scopes.filter((scope) => scopeDetails[scope].pickable).length ? (
        <p className="text-sm text-text-muted">
          Only permissions that work for your role are shown.
        </p>
      ) : null}
    </fieldset>
  );
}
