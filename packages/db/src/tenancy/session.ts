import { sql } from "drizzle-orm";

import type { Transaction } from "./scope";

/**
 * Transaction local switches read by RLS policies and triggers as `app.<flag>` = 'on'.
 * Keep this list equal to the names the migrations read; session.test.ts compares them.
 */
export const rlsFlags = [
  "account_purge",
  "approval_jobs",
  "calendar_jobs",
  "calendar_manager",
  "community_manager",
  "community_purge",
  "course_manager",
  "delegation_jobs",
  "email_delivery",
  "feedback_retention",
  "membership_hold_sweep",
  "migration_manager",
  "notification_jobs",
  "outbox_relay",
  "payments_detach",
  "payments_manager",
  "payments_webhook",
  "platform_billing",
  "posts_scheduler",
  "webhook_jobs",
  "webhooks_manager",
] as const;

export type RlsFlag = (typeof rlsFlags)[number];

/** Transaction local values read by RLS policies and triggers as `app.<name>`. */
export const rlsValues = [
  "api_token_hash",
  "api_token_owner",
  "community_id",
  "invite_token",
  "member_removal_reason",
  "oauth_grant_owner",
  "oauth_secret_hash",
  "user_id",
] as const;

export type RlsValue = (typeof rlsValues)[number];

export type RlsSetting = RlsFlag | RlsValue;

export type MemberRemovalReason = "left" | "removed" | "hold_expired";

type SessionExecutor = Pick<Transaction, "execute">;

export function rlsSettingName(setting: RlsSetting): `app.${RlsSetting}` {
  return `app.${setting}`;
}

export async function setRlsValue(
  tx: SessionExecutor,
  setting: RlsValue,
  value: string,
): Promise<void> {
  await tx.execute(sql`select set_config(${rlsSettingName(setting)}, ${value}, true)`);
}

export async function setRlsFlag(tx: SessionExecutor, flag: RlsFlag, on = true): Promise<void> {
  await tx.execute(sql`select set_config(${rlsSettingName(flag)}, ${on ? "on" : ""}, true)`);
}

export async function setRlsFlags(tx: SessionExecutor, flags: readonly RlsFlag[]): Promise<void> {
  for (const flag of flags) {
    await setRlsFlag(tx, flag);
  }
}

export async function setMemberRemovalReason(
  tx: SessionExecutor,
  reason: MemberRemovalReason | null,
): Promise<void> {
  await setRlsValue(tx, "member_removal_reason", reason ?? "");
}

export async function readRlsSetting(tx: SessionExecutor, setting: RlsSetting): Promise<string> {
  const { rows } = await tx.execute<{ value: string | null }>(
    sql`select current_setting(${rlsSettingName(setting)}, true) as value`,
  );
  return rows[0]?.value ?? "";
}

async function restoreFlags(
  tx: SessionExecutor,
  previous: ReadonlyMap<RlsFlag, string>,
): Promise<void> {
  for (const [flag, value] of previous) {
    await tx.execute(sql`select set_config(${rlsSettingName(flag)}, ${value}, true)`);
  }
}

/**
 * Turns the flags on for `fn` and puts back the values they had before. When `fn` fails, the
 * transaction may already be aborted (25P02) and refuse the reset; the caller then gets the error
 * from `fn`, and the transaction local flags die with the rollback.
 */
export async function withRlsFlags<T>(
  tx: SessionExecutor,
  flags: readonly RlsFlag[],
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<RlsFlag, string>();
  for (const flag of flags) {
    previous.set(flag, await readRlsSetting(tx, flag));
    await setRlsFlag(tx, flag);
  }
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await restoreFlags(tx, previous).catch(() => undefined);
    throw error;
  }
  await restoreFlags(tx, previous);
  return result;
}
