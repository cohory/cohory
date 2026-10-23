"use client";

import { useState } from "react";

import { Button } from "../primitives/button";
import { Select } from "../primitives/select";
import { Switch } from "../primitives/switch";

export type EmailMode = "immediate" | "daily" | "off";

export interface PreferenceRow {
  readonly type: string;
  readonly label: string;
  readonly inApp: boolean;
  readonly email: EmailMode;
}

export interface NotificationPreferencesFormProps {
  readonly rows: readonly PreferenceRow[];
  readonly digestHour: number;
  readonly timeZone: string;
  readonly timeZones: readonly string[];
  readonly weeklyDigest: boolean;
  readonly action: (formData: FormData) => void;
  readonly pending?: boolean;
  readonly status?: string | null;
  readonly error?: string | null;
}

export const emailModeLabels: Readonly<Record<EmailMode, string>> = {
  immediate: "Right away",
  daily: "Daily summary",
  off: "Off",
};

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function NotificationPreferencesForm({
  rows,
  digestHour,
  timeZone,
  timeZones,
  weeklyDigest,
  action,
  pending = false,
  status,
  error,
}: NotificationPreferencesFormProps) {
  const [values, setValues] = useState(() => rows.map((row) => ({ ...row })));
  const [weekly, setWeekly] = useState(weeklyDigest);
  const zones = timeZones.includes(timeZone) ? timeZones : [timeZone, ...timeZones];
  const update = (type: string, patch: Partial<PreferenceRow>) =>
    setValues((current) => current.map((row) => (row.type === type ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Notification settings by type</caption>
          <thead className="bg-surface-hover text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Notification
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                In the app
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {values.map((row) => (
              <tr key={row.type} className="border-t border-border">
                <th scope="row" className="px-3 py-3 font-medium text-text">
                  {row.label}
                </th>
                <td className="px-3 py-3">
                  <input
                    type="hidden"
                    name={`inApp:${row.type}`}
                    value={row.inApp ? "on" : "off"}
                  />
                  <Switch
                    checked={row.inApp}
                    onCheckedChange={(checked) => update(row.type, { inApp: checked })}
                    aria-label={`${row.label} in the app`}
                  />
                </td>
                <td className="min-w-36 px-3 py-3">
                  <Select
                    name={`email:${row.type}`}
                    aria-label={`${row.label} by email`}
                    value={row.email}
                    onChange={(event) => {
                      const mode = Object.keys(emailModeLabels).find(
                        (key): key is EmailMode => key === event.target.value,
                      );
                      if (mode) update(row.type, { email: mode });
                    }}
                  >
                    {Object.entries(emailModeLabels).map(([mode, label]) => (
                      <option key={mode} value={mode}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text">Daily summary</legend>
        <p className="text-sm text-text-muted">
          One email a day with every notification set to Daily summary.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-text">
            Send at
            <Select name="digestHour" defaultValue={String(digestHour)}>
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {formatHour(hour)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-text">
            Time zone
            <Select name="timeZone" defaultValue={timeZone}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text">Weekly digest</legend>
        <div className="flex items-center justify-between gap-3">
          <p id="weekly-digest-help" className="text-sm text-text-muted">
            One email on Monday with the top posts, new members, and coming events in your
            communities. It is sent at the same hour as the daily summary.
          </p>
          <input type="hidden" name="weeklyDigest" value={weekly ? "on" : "off"} />
          <Switch
            checked={weekly}
            onCheckedChange={setWeekly}
            aria-label="Weekly digest email"
            aria-describedby="weekly-digest-help"
          />
        </div>
      </fieldset>

      <p className="text-sm text-text-muted">
        Emails about your account, like password resets, are always sent.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving changes…" : "Save changes"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {status ?? null}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
