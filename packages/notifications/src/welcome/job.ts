import {
  getDb,
  parseCommunityId,
  runInCommunity,
  setRlsValue,
  withCommunity,
  type Database,
} from "@cohory/db";
import { communities, memberships, notificationSettings, users } from "@cohory/db/schema";
import { communityEmailBrand, sendEmail, welcomeEmail, type EmailMessage } from "@cohory/email";
import { getCommunityAccess } from "@cohory/entitlements/access";
import { and, eq, isNull } from "drizzle-orm";

import { defaultTimeZone } from "../preferences";

export interface WelcomeJobInput {
  readonly communityId: string;
  readonly userId: string;
}

export interface WelcomeExtras {
  readonly firstCourse: { readonly slug: string; readonly title: string } | null;
  readonly nextEvent: {
    readonly eventSlug: string;
    readonly occurrenceId: string;
    readonly title: string;
    readonly startsAt: Date;
  } | null;
}

export type WelcomeSource = (input: WelcomeJobInput) => Promise<WelcomeExtras>;

export interface WelcomeEmailJobDeps {
  readonly db: Database;
  readonly source: WelcomeSource;
  readonly send: (message: EmailMessage) => Promise<void>;
  readonly appUrl: string;
  readonly now?: () => Date;
}

export type WelcomeOutcome = "sent" | "skipped";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createWelcomeEmailJob(deps: WelcomeEmailJobDeps) {
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.replace(/\/+$/, "");

  return async function sendWelcome(input: WelcomeJobInput): Promise<WelcomeOutcome> {
    const scope = withCommunity(deps.db, parseCommunityId(input.communityId));
    const at = now();
    if (!(await getCommunityAccess(scope, input.userId, at)).entitled) {
      return "skipped";
    }
    const extras = await deps.source(input);
    return runInCommunity(scope, async ({ tx, where }) => {
      await setRlsValue(tx, "user_id", input.userId);
      const [row] = await tx
        .select({
          role: memberships.role,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          erasedAt: users.erasedAt,
          deletionScheduledFor: users.deletionScheduledFor,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          where(
            memberships,
            eq(memberships.userId, input.userId),
            eq(memberships.status, "active"),
            isNull(memberships.welcomeEmailSentAt),
          ),
        )
        .for("update", { of: memberships });
      if (
        !row ||
        row.role === "owner" ||
        !row.emailVerified ||
        row.erasedAt !== null ||
        row.deletionScheduledFor !== null
      ) {
        return "skipped";
      }
      const [community] = await tx
        .select({
          slug: communities.slug,
          name: communities.name,
          appearance: communities.appearance,
        })
        .from(communities)
        .where(and(eq(communities.id, input.communityId), isNull(communities.deletedAt)));
      if (!community) {
        return "skipped";
      }
      const [creator] = await tx
        .select({ name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where(memberships, eq(memberships.role, "owner")));
      const [settings] = await tx
        .select({ timeZone: notificationSettings.timeZone })
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, input.userId));
      const base = `${appUrl}/c/${segment(community.slug)}`;
      const when = new Intl.DateTimeFormat("en-US", {
        timeZone: settings?.timeZone ?? defaultTimeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      const { firstCourse, nextEvent } = extras;
      await deps.send({
        to: row.email,
        ...welcomeEmail({
          name: row.name,
          communityName: community.name,
          creatorName: creator?.name ?? null,
          communityBrand: communityEmailBrand(community.appearance),
          introduceUrl: `${base}?compose=1`,
          feedUrl: base,
          firstCourse: firstCourse
            ? { title: firstCourse.title, url: `${base}/classroom/${segment(firstCourse.slug)}` }
            : null,
          nextEvent: nextEvent
            ? {
                title: nextEvent.title,
                when: when.format(nextEvent.startsAt),
                url: `${base}/calendar/${segment(nextEvent.eventSlug)}/${segment(nextEvent.occurrenceId)}`,
              }
            : null,
          preferencesUrl: `${appUrl}/account/notifications`,
        }),
      });
      await tx
        .update(memberships)
        .set({ welcomeEmailSentAt: at })
        .where(where(memberships, eq(memberships.userId, input.userId)));
      return "sent";
    });
  };
}

export type SendWelcomeEmail = ReturnType<typeof createWelcomeEmailJob>;

let defaultJob: SendWelcomeEmail | undefined;

export function getWelcomeEmailJob(appUrl: string, source: WelcomeSource): SendWelcomeEmail {
  defaultJob ??= createWelcomeEmailJob({ db: getDb(), source, send: sendEmail, appUrl });
  return defaultJob;
}
