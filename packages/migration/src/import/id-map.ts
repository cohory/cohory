import { newId, type Database } from "@cohory/db";
import { migrationIdMap } from "@cohory/db/schema";
import { eq } from "drizzle-orm";

import { inMigrationScope, type MigrationTx } from "../scope";

export interface MappedId {
  readonly entity: string;
  readonly sourceId: string;
  readonly targetId: string;
}

export class IdMap {
  private readonly maps = new Map<string, Map<string, string>>();

  constructor(
    readonly communityId: string,
    readonly jobId: string,
  ) {}

  static async load(db: Database, communityId: string, jobId: string): Promise<IdMap> {
    const map = new IdMap(communityId, jobId);
    const rows = await inMigrationScope(db, communityId, ({ tx, where }) =>
      tx
        .select({
          entity: migrationIdMap.entity,
          sourceId: migrationIdMap.sourceId,
          targetId: migrationIdMap.targetId,
        })
        .from(migrationIdMap)
        .where(where(migrationIdMap, eq(migrationIdMap.jobId, jobId))),
    );
    for (const row of rows) {
      map.remember(row);
    }
    return map;
  }

  get size(): number {
    let total = 0;
    for (const entries of this.maps.values()) total += entries.size;
    return total;
  }

  count(entity: string): number {
    return this.maps.get(entity)?.size ?? 0;
  }

  get(entity: string, sourceId: string | null | undefined): string | undefined {
    return sourceId ? this.maps.get(entity)?.get(sourceId) : undefined;
  }

  entries(entity: string): MappedId[] {
    return [...(this.maps.get(entity) ?? [])].map(([sourceId, targetId]) => ({
      entity,
      sourceId,
      targetId,
    }));
  }

  has(entity: string, sourceId: string): boolean {
    return this.maps.get(entity)?.has(sourceId) ?? false;
  }

  remember(entry: MappedId): void {
    let entries = this.maps.get(entry.entity);
    if (!entries) {
      entries = new Map();
      this.maps.set(entry.entity, entries);
    }
    entries.set(entry.sourceId, entry.targetId);
  }

  forget(entries: readonly MappedId[]): void {
    for (const entry of entries) {
      this.maps.get(entry.entity)?.delete(entry.sourceId);
    }
  }

  assign(entity: string, sourceId: string, targetId: string = newId()): MappedId {
    const entry = { entity, sourceId, targetId };
    this.remember(entry);
    return entry;
  }

  async persist(tx: MigrationTx, entries: readonly MappedId[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await tx
      .insert(migrationIdMap)
      .values(
        entries.map((entry) => ({
          communityId: this.communityId,
          jobId: this.jobId,
          entity: entry.entity,
          sourceId: entry.sourceId,
          targetId: entry.targetId,
        })),
      )
      .onConflictDoNothing();
  }
}

// A placeholder's real address lives only here, so invitations can still go out after the
// uploaded files are deleted. Archive ids are UUIDs, so the first colon ends the id.
export function placeholderEmailKey(sourceUserId: string, email: string): string {
  return `${sourceUserId}:${email.toLowerCase()}`;
}

export function parsePlaceholderEmailKey(key: string): { sourceUserId: string; email: string } {
  const at = key.indexOf(":");
  return { sourceUserId: key.slice(0, at), email: key.slice(at + 1) };
}
