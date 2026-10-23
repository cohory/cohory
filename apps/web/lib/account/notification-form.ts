import {
  deliveredNotificationTypes,
  notificationEmailModes,
  type UpdatePreferencesInput,
} from "@cohory/notifications";
import { z } from "zod";

const preferenceTypes = deliveredNotificationTypes;

const formSchema = z.object({
  digestHour: z.coerce.number().int().min(0).max(23),
  timeZone: z.string().min(1).max(64),
  weeklyDigest: z.enum(["on", "off"]).transform((value) => value === "on"),
  types: z.array(
    z.object({
      type: z.enum(preferenceTypes),
      inApp: z.boolean(),
      email: z.enum(notificationEmailModes),
    }),
  ),
});

export function parseNotificationPreferencesForm(
  formData: FormData,
): UpdatePreferencesInput | null {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const parsed = formSchema.safeParse({
    digestHour: field("digestHour"),
    timeZone: field("timeZone"),
    weeklyDigest: field("weeklyDigest"),
    types: preferenceTypes.map((type) => ({
      type,
      inApp: field(`inApp:${type}`) === "on",
      email: field(`email:${type}`),
    })),
  });
  return parsed.success ? parsed.data : null;
}

export function listTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}
