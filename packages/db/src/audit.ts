import { AsyncLocalStorage } from "node:async_hooks";

import { auditLog, type AuditActorType, type AuditVia } from "./schema/manage";
import type { ScopedQueries } from "./tenancy";

export interface AuditEntryInput {
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly at?: Date;
}

export interface AuditSource {
  readonly actorType: Exclude<AuditActorType, "system">;
  readonly via: AuditVia;
  readonly tokenId: string | null;
  readonly agentId: string | null;
}

export interface AuditSourceColumns {
  readonly actorType: AuditActorType | null;
  readonly via: AuditVia | null;
  readonly tokenId: string | null;
  readonly agentId: string | null;
}

interface AuditScope {
  readonly source: AuditSource;
  written: number;
}

const auditScope = new AsyncLocalStorage<AuditScope>();

export function runWithAuditSource<T>(source: AuditSource, fn: () => T): T {
  return auditScope.run({ source, written: 0 }, fn);
}

export function auditEntriesWritten(): number {
  return auditScope.getStore()?.written ?? 0;
}

export function auditSourceColumns(actorId: string | null): AuditSourceColumns {
  const scope = auditScope.getStore();
  if (scope) {
    scope.written += 1;
    return { ...scope.source };
  }
  return { actorType: actorId ? "user" : "system", via: null, tokenId: null, agentId: null };
}

export async function appendAuditEntry(
  { tx, values }: Pick<ScopedQueries, "tx" | "values">,
  entry: AuditEntryInput,
): Promise<void> {
  await tx.insert(auditLog).values(
    values({
      actorId: entry.actorId,
      ...auditSourceColumns(entry.actorId),
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata ?? null,
      ...(entry.at ? { createdAt: entry.at } : {}),
    }),
  );
}
