import {
  preferenceFor,
  type NotificationEmailMode,
  type NotificationPreferences,
} from "../preferences";
import type { DeliveredNotificationType } from "../types";

export type EmailPass = "immediate" | "digest";

export const immediateHoldMs = 3 * 60 * 1000;
export const immediateMaxAgeMs = 24 * 60 * 60 * 1000;
export const digestMaxAgeMs = 48 * 60 * 60 * 1000;
export const digestMinGapMs = 20 * 60 * 60 * 1000;
export const digestMaxItems = 50;

export interface PendingNotification {
  readonly id: string;
  readonly type: DeliveredNotificationType;
  readonly communityId: string | null;
  readonly postId: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  readonly emailMode?: NotificationEmailMode;
}

export interface EmailPlan<N extends PendingNotification> {
  readonly immediate: readonly (readonly N[])[];
  readonly digest: readonly N[];
  readonly skip: readonly N[];
}

export function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).format(at);
  return Number.parseInt(hour, 10) % 24;
}

export function isDigestDue(
  now: Date,
  preferences: Pick<NotificationPreferences, "digestHour" | "timeZone">,
  lastDigestAt: Date | null,
): boolean {
  if (localHour(now, preferences.timeZone) !== preferences.digestHour) {
    return false;
  }
  return lastDigestAt === null || now.getTime() - lastDigestAt.getTime() >= digestMinGapMs;
}

function groupKey(n: PendingNotification): string {
  if (n.type === "join_request") {
    return `join:${n.communityId ?? n.id}`;
  }
  return n.postId ? `post:${n.postId}` : `one:${n.id}`;
}

function dueGroups<N extends PendingNotification>(items: readonly N[], now: Date): N[][] {
  const groups = new Map<string, N[]>();
  const oldestFirst = [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const n of oldestFirst) {
    groups.set(groupKey(n), [...(groups.get(groupKey(n)) ?? []), n]);
  }
  return [...groups.values()].filter(
    ([oldest]) =>
      oldest !== undefined && now.getTime() - oldest.createdAt.getTime() >= immediateHoldMs,
  );
}

export function planEmails<N extends PendingNotification>(input: {
  readonly pass: EmailPass;
  readonly pending: readonly N[];
  readonly preferences: NotificationPreferences;
  readonly lastDigestAt: Date | null;
  readonly now: Date;
}): EmailPlan<N> {
  const { pass, preferences, now } = input;
  const age = (n: N) => now.getTime() - n.createdAt.getTime();
  const digestDue = pass === "digest" && isDigestDue(now, preferences, input.lastDigestAt);
  const immediate: N[] = [];
  const digest: N[] = [];
  const skip: N[] = [];

  for (const n of input.pending) {
    const mode = n.emailMode ?? preferenceFor(preferences, n.type).email;
    if (mode === "off" || n.readAt !== null) {
      skip.push(n);
    } else if (mode === "immediate" && pass === "immediate") {
      (age(n) <= immediateMaxAgeMs ? immediate : skip).push(n);
    } else if (mode === "daily" && pass === "digest") {
      if (age(n) > digestMaxAgeMs) {
        skip.push(n);
      } else if (digestDue) {
        digest.push(n);
      }
    }
  }

  const newestFirst = digest.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    immediate: dueGroups(immediate, now),
    digest: newestFirst.slice(0, digestMaxItems),
    skip: [...skip, ...newestFirst.slice(digestMaxItems)],
  };
}
