import type { MemberRole, MemberStatus } from "@cohory/db/schema";

export const csvBom = "﻿";

export const membersCsvColumns = [
  "email",
  "name",
  "username",
  "role",
  "joined_at",
  "level",
  "points",
  "status",
  "stripe_customer_id",
  "stripe_subscription_id",
  "last_active_at",
  "access",
  "signed_in",
] as const;

export interface MembersCsvMember {
  readonly email: string;
  readonly name: string;
  readonly username: string | null;
  readonly role: MemberRole;
  readonly joinedAt: Date | null;
  readonly level: number;
  readonly points: number;
  readonly status: MemberStatus;
  readonly lastActiveAt: Date;
  readonly signedIn: boolean;
}

const formulaTrigger = /^[=+\-@\t\r]/;
const needsQuotes = /[",\r\n]/;

export function csvField(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  const safe = formulaTrigger.test(value) ? `'${value}` : value;
  return needsQuotes.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly (string | number | null)[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}

export function membersCsvRow(member: MembersCsvMember, access: string | null): string {
  return csvRow([
    member.email,
    member.name,
    member.username,
    member.role,
    member.joinedAt ? member.joinedAt.toISOString() : null,
    member.level,
    member.points,
    member.status,
    null,
    null,
    member.lastActiveAt.toISOString(),
    access,
    member.signedIn ? "yes" : "no",
  ]);
}

export function membersCsvFilename(slug: string, now: Date): string {
  return `${slug}-members-${now.toISOString().slice(0, 10)}.csv`;
}
