import type { NotificationEmailMode } from "@cohory/db/schema";
import { z } from "zod";

import { deliveredNotificationTypes, type DeliveredNotificationType } from "./types";

export type { NotificationEmailMode };

export const notificationEmailModes = [
  "immediate",
  "daily",
  "off",
] as const satisfies readonly NotificationEmailMode[];

export interface TypePreference {
  readonly type: DeliveredNotificationType;
  readonly inApp: boolean;
  readonly email: NotificationEmailMode;
}

export interface NotificationPreferences {
  readonly types: readonly TypePreference[];
  readonly digestHour: number;
  readonly timeZone: string;
  readonly weeklyDigest: boolean;
}

export const defaultTypePreferences: Readonly<Record<DeliveredNotificationType, TypePreference>> = {
  mention: { type: "mention", inApp: true, email: "immediate" },
  reply: { type: "reply", inApp: true, email: "immediate" },
  comment_on_post: { type: "comment_on_post", inApp: true, email: "daily" },
  join_request: { type: "join_request", inApp: true, email: "immediate" },
  join_request_approved: { type: "join_request_approved", inApp: true, email: "immediate" },
  join_request_declined: { type: "join_request_declined", inApp: true, email: "immediate" },
  approval_request: { type: "approval_request", inApp: true, email: "immediate" },
  agent_access: { type: "agent_access", inApp: true, email: "immediate" },
  report_actioned: { type: "report_actioned", inApp: true, email: "off" },
  report_dismissed: { type: "report_dismissed", inApp: true, email: "off" },
  review_created: { type: "review_created", inApp: true, email: "immediate" },
  member_joined: { type: "member_joined", inApp: true, email: "daily" },
  like_on_post: { type: "like_on_post", inApp: true, email: "off" },
  like_on_comment: { type: "like_on_comment", inApp: true, email: "off" },
  report_created: { type: "report_created", inApp: true, email: "off" },
  paid_member_joined: { type: "paid_member_joined", inApp: true, email: "off" },
  paid_member_canceled: { type: "paid_member_canceled", inApp: true, email: "off" },
  event_created: { type: "event_created", inApp: true, email: "off" },
  event_reminder: { type: "event_reminder", inApp: true, email: "immediate" },
  comment_on_followed_post: { type: "comment_on_followed_post", inApp: true, email: "daily" },
};

export function defaultEmailMode(
  type: DeliveredNotificationType,
  role: string | null,
): NotificationEmailMode {
  return type === "join_request" && role !== "owner" ? "daily" : defaultTypePreferences[type].email;
}

export const defaultDigestHour = 8;
export const defaultTimeZone = "UTC";
export const defaultWeeklyDigest = true;

export const notificationTypeLabels: Readonly<Record<DeliveredNotificationType, string>> = {
  mention: "Mentions",
  reply: "Replies to your comments",
  comment_on_post: "Comments on your posts",
  join_request: "Requests to join communities you help run",
  join_request_approved: "Your join request was approved",
  join_request_declined: "Your join request was declined",
  approval_request: "Agents asking for your approval",
  agent_access: "Your agents' course access and purchase requests",
  report_actioned: "A moderator acted on something you reported",
  report_dismissed: "A moderator reviewed something you reported and left it up",
  review_created: "New reviews of communities you own",
  member_joined: "New members in communities you run",
  like_on_post: "Likes on your posts",
  like_on_comment: "Likes on your comments",
  report_created: "New reports in communities you moderate",
  paid_member_joined: "New paying members in communities you own",
  paid_member_canceled: "Paid memberships canceled in communities you own",
  event_created: "New events",
  event_reminder: "Reminders for events you are going to",
  comment_on_followed_post: "Comments on posts you follow",
};

export const emailReasons: Readonly<Record<DeliveredNotificationType, string>> = {
  mention: "mentions",
  reply: "replies to your comments",
  comment_on_post: "comments on your posts",
  join_request: "requests to join communities you help run",
  join_request_approved: "answers to your join requests",
  join_request_declined: "answers to your join requests",
  approval_request: "agents asking for your approval",
  agent_access: "your agents' course access and purchase requests",
  report_actioned: "the outcome of your reports",
  report_dismissed: "the outcome of your reports",
  review_created: "new reviews of communities you own",
  member_joined: "new members in communities you run",
  like_on_post: "likes on your posts",
  like_on_comment: "likes on your comments",
  report_created: "new reports in communities you moderate",
  paid_member_joined: "new paying members in communities you own",
  paid_member_canceled: "canceled paid memberships in communities you own",
  event_created: "new events",
  event_reminder: "reminders for events you are going to",
  comment_on_followed_post: "comments on posts you follow",
};

export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const typePreferenceSchema = z.strictObject({
  type: z.enum(deliveredNotificationTypes),
  inApp: z.boolean(),
  email: z.enum(notificationEmailModes),
});

export const updatePreferencesInputSchema = z.strictObject({
  types: z
    .array(typePreferenceSchema)
    .max(deliveredNotificationTypes.length)
    .refine((items) => new Set(items.map((item) => item.type)).size === items.length, {
      error: "List each notification type once.",
    })
    .optional(),
  digestHour: z.int().min(0).max(23).optional(),
  timeZone: z
    .string()
    .refine(isTimeZone, { error: "Choose a time zone from the list." })
    .optional(),
  weeklyDigest: z.boolean().optional(),
});

export type UpdatePreferencesInput = z.input<typeof updatePreferencesInputSchema>;

export interface StoredTypePreference {
  readonly type: string;
  readonly inApp: boolean;
  readonly email: NotificationEmailMode;
}

export interface StoredSettings {
  readonly digestHour: number;
  readonly timeZone: string;
  readonly weeklyDigest: boolean;
}

export function resolvePreferences(
  rows: readonly StoredTypePreference[],
  settings: StoredSettings | null,
  fallbackTimeZone: string = defaultTimeZone,
  role?: string | null,
): NotificationPreferences {
  const stored = new Map(rows.map((row) => [row.type, row]));
  return {
    types: deliveredNotificationTypes.map((type) => {
      const row = stored.get(type);
      if (row) {
        return { type, inApp: row.inApp, email: row.email };
      }
      const fallback = defaultTypePreferences[type];
      return role === undefined ? fallback : { ...fallback, email: defaultEmailMode(type, role) };
    }),
    digestHour: settings?.digestHour ?? defaultDigestHour,
    timeZone:
      settings?.timeZone ?? (isTimeZone(fallbackTimeZone) ? fallbackTimeZone : defaultTimeZone),
    weeklyDigest: settings?.weeklyDigest ?? defaultWeeklyDigest,
  };
}

export function preferenceFor(
  preferences: NotificationPreferences,
  type: DeliveredNotificationType,
): TypePreference {
  return preferences.types.find((item) => item.type === type) ?? defaultTypePreferences[type];
}
