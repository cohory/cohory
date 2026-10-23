"use client";

import { Button, Field, Input, Select, cn } from "@cohory/ui";
import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import {
  accessFilters,
  accessLabels,
  activeFilterCount,
  activityFilters,
  parseInactiveDays,
  roleFilters,
  statusFilters,
  type ActivityFilter,
  type PeopleFilters,
  type RoleFilter,
  type StatusFilter,
} from "../../lib/manage/people-filters";

const roleLabels: Record<RoleFilter | "", string> = {
  "": "All roles",
  owner: "Creator",
  admin: "Admins",
  moderator: "Moderators",
  member: "Members",
};

const statusLabels: Record<StatusFilter, string> = {
  active: "Active",
  removed: "Removed",
  banned: "Banned",
};

function activityLabel(value: ActivityFilter): string {
  switch (value) {
    case "any":
      return "Any time";
    case "custom":
      return "Inactive for a number of days";
    case "never":
      return "Not signed in yet";
    default:
      return `Inactive for ${value} days`;
  }
}

function pick<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

export function PeopleFiltersBar({
  filters,
  onChange,
  showEmail,
  canSeeAccess,
}: {
  filters: PeopleFilters;
  onChange(next: PeopleFilters): void;
  showEmail: boolean;
  canSeeAccess: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = activeFilterCount(filters);
  const inactive = filters.activity !== "any" && filters.activity !== "never";
  const customInvalid =
    filters.activity === "custom" &&
    filters.customDays !== "" &&
    parseInactiveDays(filters.customDays) === null;

  function set(patch: Partial<PeopleFilters>) {
    onChange({ ...filters, ...patch });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field label="Search" className="min-w-0 flex-1">
          {(control) => (
            <Input
              {...control}
              type="search"
              placeholder={showEmail ? "Name, username, or email" : "Name or username"}
              value={filters.query}
              onChange={(event) => set({ query: event.target.value })}
            />
          )}
        </Field>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 sm:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" strokeWidth={1.5} />
          {count > 0 ? `Filters (${count})` : "Filters"}
        </Button>
      </div>
      <div
        id={panelId}
        className={cn("gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4", open ? "grid" : "hidden")}
      >
        <Field label="Role">
          {(control) => (
            <Select
              {...control}
              value={filters.role}
              onChange={(event) =>
                set({ role: pick<RoleFilter | "">(roleFilters, event.target.value, "") })
              }
            >
              {(["", ...roleFilters] as const).map((value) => (
                <option key={value} value={value}>
                  {roleLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Status"
          description={inactive ? "Inactive members are active members." : undefined}
          hint={inactive ? undefined : "Waiting to join? See the Requests tab."}
        >
          {(control) => (
            <Select
              {...control}
              disabled={inactive}
              value={inactive ? "active" : filters.status}
              onChange={(event) =>
                set({ status: pick(statusFilters, event.target.value, "active") })
              }
            >
              {statusFilters.map((value) => (
                <option key={value} value={value}>
                  {statusLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Last active"
          hint="Counts posts, comments, likes, lessons, RSVPs, and sign ins."
        >
          {(control) => (
            <Select
              {...control}
              value={filters.activity}
              onChange={(event) =>
                set({ activity: pick(activityFilters, event.target.value, "any") })
              }
            >
              {activityFilters.map((value) => (
                <option key={value} value={value}>
                  {activityLabel(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {canSeeAccess ? (
          <Field label="Access">
            {(control) => (
              <Select
                {...control}
                value={filters.access}
                onChange={(event) =>
                  set({ access: pick(["", ...accessFilters] as const, event.target.value, "") })
                }
              >
                <option value="">Everyone</option>
                {accessFilters.map((value) => (
                  <option key={value} value={value}>
                    {accessLabels[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {filters.activity === "custom" ? (
          <Field
            label="Days without activity"
            error={customInvalid ? "Enter a whole number from 1 to 3650." : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={1}
                value={filters.customDays}
                onChange={(event) => set({ customDays: event.target.value })}
              />
            )}
          </Field>
        ) : null}
      </div>
    </div>
  );
}
