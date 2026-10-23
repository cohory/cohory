import type { Database } from "@cohory/db";
import { webhookEndpoints } from "@cohory/db/schema";
import {
  needsReencryption,
  reencryptSecret,
  SecretDecryptionError,
  type Keyring,
} from "@cohory/payments/crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { setRlsFlag } from "@cohory/db";

import { webhookSecretContext } from "./env";

export interface WebhookSecretRotationResult {
  readonly scanned: number;
  readonly reencrypted: number;
  readonly unreadable: readonly string[];
}

const batchSize = 100;

export async function reencryptWebhookSecrets(
  db: Database,
  keys: Keyring,
): Promise<WebhookSecretRotationResult> {
  let scanned = 0;
  let reencrypted = 0;
  const unreadable: string[] = [];
  let afterId: string | null = null;
  for (;;) {
    const cursor: string | null = afterId;
    const page: { rows: { id: string }[]; changed: number } = await db.transaction(async (tx) => {
      await setRlsFlag(tx, "webhook_jobs");
      const rows = await tx
        .select({
          id: webhookEndpoints.id,
          sealed: webhookEndpoints.secretCiphertext,
          previous: webhookEndpoints.previousSecretCiphertext,
          previousExpiresAt: webhookEndpoints.previousSecretExpiresAt,
        })
        .from(webhookEndpoints)
        .where(cursor ? gt(webhookEndpoints.id, cursor) : undefined)
        .orderBy(webhookEndpoints.id)
        .limit(batchSize);
      const now = new Date();
      let changed = 0;
      for (const row of rows) {
        const overlapping =
          row.previous !== null && row.previousExpiresAt !== null && row.previousExpiresAt > now
            ? row.previous
            : null;
        const stale = [row.sealed, overlapping].filter(
          (sealed): sealed is string => sealed !== null && needsReencryption(sealed, keys),
        );
        if (stale.length === 0) {
          continue;
        }
        let next: { secretCiphertext?: string; previousSecretCiphertext?: string };
        try {
          next = {
            ...(needsReencryption(row.sealed, keys)
              ? {
                  secretCiphertext: reencryptSecret(row.sealed, keys, webhookSecretContext(row.id)),
                }
              : {}),
            ...(overlapping && needsReencryption(overlapping, keys)
              ? {
                  previousSecretCiphertext: reencryptSecret(
                    overlapping,
                    keys,
                    webhookSecretContext(row.id),
                  ),
                }
              : {}),
          };
        } catch (error: unknown) {
          if (!(error instanceof SecretDecryptionError)) {
            throw error;
          }
          unreadable.push(row.id);
          continue;
        }
        const updated = await tx
          .update(webhookEndpoints)
          .set(next)
          .where(
            and(
              eq(webhookEndpoints.id, row.id),
              eq(webhookEndpoints.secretCiphertext, row.sealed),
              sql`${webhookEndpoints.previousSecretCiphertext} is not distinct from ${row.previous}`,
            ),
          )
          .returning({ id: webhookEndpoints.id });
        changed += updated.length;
      }
      return { rows, changed };
    });
    scanned += page.rows.length;
    reencrypted += page.changed;
    const last = page.rows.at(-1);
    if (!last || page.rows.length < batchSize) {
      return { scanned, reencrypted, unreadable };
    }
    afterId = last.id;
  }
}
