import { assertCan, UnauthenticatedError, type Actor } from "@cohory/authz";
import { getDb, setRlsValue, type Database, type Transaction } from "@cohory/db";
import {
  memberships,
  notificationPreferences,
  notificationSettings,
  users,
} from "@cohory/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import { NotificationValidationError } from "./errors";
import {
  notificationTypeLabels,
  resolvePreferences,
  updatePreferencesInputSchema,
  type NotificationPreferences,
  type UpdatePreferencesInput,
} from "./preferences";
import {
  unsubscribeSecretFromEnv,
  verifyUnsubscribeToken,
  type UnsubscribeClaim,
  type UnsubscribeScope,
} from "./unsubscribe";

export interface PreferencesServiceDeps {
  readonly db: Database;
  readonly secret: string;
  readonly now?: () => Date;
}

export interface UnsubscribeResult {
  readonly scope: UnsubscribeScope;
  readonly label: string;
}

export function unsubscribeLabel(scope: UnsubscribeScope): string {
  if (scope === "daily") {
    return "daily summaries";
  }
  if (scope === "weekly") {
    return "weekly digests";
  }
  return notificationTypeLabels[scope].toLowerCase();
}

interface Loaded {
  readonly preferences: NotificationPreferences;
  readonly stored: ReadonlySet<string>;
  readonly helpsRun: boolean;
}

export function createPreferencesService(deps: PreferencesServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await setRlsValue(tx, "user_id", userId);
      return fn(tx);
    });
  }

  function requireUserId(actor: Actor): string {
    if (actor.kind !== "user") {
      throw new UnauthenticatedError();
    }
    assertCan(actor, "update_own", "account");
    return actor.userId;
  }

  async function load(
    tx: Transaction,
    userId: string,
    fallbackTimeZone?: string,
  ): Promise<NotificationPreferences> {
    return (await loadWithRoles(tx, userId, fallbackTimeZone)).preferences;
  }

  async function loadWithRoles(
    tx: Transaction,
    userId: string,
    fallbackTimeZone?: string,
  ): Promise<Loaded> {
    const rows = await tx
      .select({
        type: notificationPreferences.type,
        inApp: notificationPreferences.inApp,
        email: notificationPreferences.email,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const [settings] = await tx
      .select({
        digestHour: notificationSettings.digestHour,
        timeZone: notificationSettings.timeZone,
        weeklyDigest: notificationSettings.weeklyDigest,
      })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    const roles = await tx
      .selectDistinct({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
    const held = new Set(roles.map((row) => row.role));
    return {
      preferences: resolvePreferences(
        rows,
        settings ?? null,
        fallbackTimeZone,
        held.has("owner") ? "owner" : null,
      ),
      stored: new Set(rows.map((row) => row.type)),
      helpsRun: held.has("admin") || held.has("moderator"),
    };
  }

  async function writeTypes(
    tx: Transaction,
    userId: string,
    types: NotificationPreferences["types"],
  ): Promise<void> {
    if (types.length === 0) {
      return;
    }
    const updatedAt = now();
    await tx
      .insert(notificationPreferences)
      .values(types.map((item) => ({ userId, ...item, updatedAt })))
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          inApp: sql`excluded.in_app`,
          email: sql`excluded.email`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async function writeSettings(
    tx: Transaction,
    userId: string,
    settings: Omit<NotificationPreferences, "types">,
  ): Promise<void> {
    const next = { ...settings, updatedAt: now() };
    await tx
      .insert(notificationSettings)
      .values({ userId, ...next })
      .onConflictDoUpdate({ target: notificationSettings.userId, set: next });
  }

  return {
    async getPreferences(
      actor: Actor,
      options: { fallbackTimeZone?: string } = {},
    ): Promise<NotificationPreferences> {
      const userId = requireUserId(actor);
      return asUser(userId, (tx) => load(tx, userId, options.fallbackTimeZone));
    },

    async updatePreferences(
      actor: Actor,
      input: UpdatePreferencesInput,
    ): Promise<NotificationPreferences> {
      const userId = requireUserId(actor);
      const parsed = updatePreferencesInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new NotificationValidationError(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        );
      }
      const { types = [], digestHour, timeZone, weeklyDigest } = parsed.data;
      return asUser(userId, async (tx) => {
        const loaded = await loadWithRoles(tx, userId, timeZone);
        const current = loaded.preferences;
        // A type still on its default is only written when it changes, so a role based
        // default keeps following the role instead of being frozen by an unrelated save.
        const changed = types.filter((item) => {
          const before = current.types.find((type) => type.type === item.type);
          return (
            loaded.stored.has(item.type) ||
            before?.email !== item.email ||
            before.inApp !== item.inApp
          );
        });
        await writeTypes(tx, userId, changed);
        if (digestHour !== undefined || timeZone !== undefined || weeklyDigest !== undefined) {
          await writeSettings(tx, userId, {
            digestHour: digestHour ?? current.digestHour,
            timeZone: timeZone ?? current.timeZone,
            weeklyDigest: weeklyDigest ?? current.weeklyDigest,
          });
        }
        return load(tx, userId, timeZone);
      });
    },

    readUnsubscribeToken(token: string): UnsubscribeClaim | null {
      return verifyUnsubscribeToken(deps.secret, token);
    },

    async unsubscribe(token: string): Promise<UnsubscribeResult | null> {
      const claim = verifyUnsubscribeToken(deps.secret, token);
      if (!claim) {
        return null;
      }
      const applied = await asUser(claim.userId, async (tx) => {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, claim.userId), isNull(users.erasedAt)));
        if (!user) return null;
        const loaded = await loadWithRoles(tx, claim.userId);
        const current = loaded.preferences;
        if (claim.scope === "weekly") {
          await writeSettings(tx, claim.userId, {
            digestHour: current.digestHour,
            timeZone: current.timeZone,
            weeklyDigest: false,
          });
          return unsubscribeLabel(claim.scope);
        }
        // An admin or moderator gets join requests in the summary until they choose, even
        // when the page shows Right away because they also own a community.
        const joinRequestsInSummary =
          claim.scope === "daily" && loaded.helpsRun && !loaded.stored.has("join_request");
        const types = current.types
          .filter((item) =>
            claim.scope === "daily"
              ? item.email === "daily" || (item.type === "join_request" && joinRequestsInSummary)
              : item.type === claim.scope,
          )
          .map((item) => ({ ...item, email: "off" as const }));
        await writeTypes(tx, claim.userId, types);
        return joinRequestsInSummary
          ? `${unsubscribeLabel(claim.scope)} and join requests`
          : unsubscribeLabel(claim.scope);
      });
      if (applied === null) return null;
      return { scope: claim.scope, label: applied };
    },
  };
}

export type PreferencesService = ReturnType<typeof createPreferencesService>;

let defaultService: PreferencesService | undefined;

export function getPreferencesService(): PreferencesService {
  defaultService ??= createPreferencesService({ db: getDb(), secret: unsubscribeSecretFromEnv() });
  return defaultService;
}
