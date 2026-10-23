"use server";

import { getPreferencesService } from "@cohory/notifications";

export type UnsubscribeState =
  { status: "idle" } | { status: "done"; label: string } | { status: "invalid" };

export async function confirmUnsubscribe(
  _previous: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const token = formData.get("token");
  if (typeof token !== "string") {
    return { status: "invalid" };
  }
  const result = await getPreferencesService().unsubscribe(token);
  return result ? { status: "done", label: result.label } : { status: "invalid" };
}
