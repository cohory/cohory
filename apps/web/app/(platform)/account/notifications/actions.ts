"use server";

import { getPreferencesService, NotificationValidationError } from "@cohory/notifications";
import { revalidatePath } from "next/cache";

import { actorFor } from "../../../../lib/actor";
import { parseNotificationPreferencesForm } from "../../../../lib/account/notification-form";
import { requireAccountSession } from "../session";

export type PreferencesFormState =
  { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

export async function savePreferences(
  _previous: PreferencesFormState,
  formData: FormData,
): Promise<PreferencesFormState> {
  const session = await requireAccountSession("/account/notifications");
  const input = parseNotificationPreferencesForm(formData);
  if (!input) {
    return { status: "error", message: "Some choices are not valid. Check them and try again." };
  }
  try {
    await getPreferencesService().updatePreferences(actorFor(session), input);
  } catch (error) {
    if (error instanceof NotificationValidationError) {
      return { status: "error", message: error.issues[0]?.message ?? "Check your choices." };
    }
    throw error;
  }
  revalidatePath("/account/notifications");
  return { status: "saved", message: "Changes saved." };
}
