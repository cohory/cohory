"use client";

import { NotificationPreferencesForm, type PreferenceRow } from "@cohory/ui";
import { useActionState } from "react";

import { savePreferences, type PreferencesFormState } from "./actions";

const initialState: PreferencesFormState = { status: "idle" };

export function Preferences(props: {
  rows: PreferenceRow[];
  digestHour: number;
  timeZone: string;
  timeZones: string[];
  weeklyDigest: boolean;
}) {
  const [state, action, pending] = useActionState(savePreferences, initialState);

  return (
    <NotificationPreferencesForm
      {...props}
      action={action}
      pending={pending}
      status={state.status === "saved" ? state.message : null}
      error={state.status === "error" ? state.message : null}
    />
  );
}
