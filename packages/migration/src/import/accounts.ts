import type { Edition } from "@cohory/config/edition";
import { users } from "@cohory/db/schema";
import { inArray, sql } from "drizzle-orm";

import type { MigrationTx } from "../scope";

export type { Edition };

export interface AccountLinkRule {
  readonly edition: Edition;
  readonly ownerUserId: string;
}

interface ExistingAccount {
  readonly id: string;
  readonly emailVerified: boolean;
}

export type AccountMatch =
  | { readonly kind: "link"; readonly userId: string }
  | { readonly kind: "placeholder" }
  | { readonly kind: "none" };

export async function findAccounts(
  tx: MigrationTx,
  emails: readonly string[],
): Promise<Map<string, ExistingAccount>> {
  if (emails.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(
      inArray(
        sql`lower(${users.email}::text)`,
        emails.map((email) => email.toLowerCase()),
      ),
    );
  return new Map(
    rows.map((row) => [row.email.toLowerCase(), { id: row.id, emailVerified: row.emailVerified }]),
  );
}

// On Cloud nobody gets an account or a membership from an import without acting themselves,
// so every person except the importing owner stays a placeholder until they accept an invite.
export function matchAccount(
  account: ExistingAccount | undefined,
  rule: AccountLinkRule,
): AccountMatch {
  if (!account) return rule.edition === "cloud" ? { kind: "placeholder" } : { kind: "none" };
  if (account.id === rule.ownerUserId) return { kind: "link", userId: account.id };
  if (rule.edition === "community" && account.emailVerified) {
    return { kind: "link", userId: account.id };
  }
  return { kind: "placeholder" };
}

export function placeholderEmail(id: string): string {
  return `imported-${id}@import.invalid`;
}
