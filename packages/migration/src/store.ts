import { newId, type Database } from "@cohory/db";
import {
  migrationJobs,
  type MigrationEmailChoice,
  type MigrationJob,
  type MigrationJobKind,
  type MigrationJobStatus,
  type MigrationProgressJson,
} from "@cohory/db/schema";
import { and, desc, eq, inArray, isNull, lte, notInArray } from "drizzle-orm";

import { inMigrationScope } from "./scope";

export interface NewJob {
  readonly id?: string;
  readonly kind: MigrationJobKind;
  readonly status: MigrationJobStatus;
  readonly requestedBy: string | null;
  readonly fileKey?: string | null;
  readonly fileName?: string | null;
  readonly fileBytes?: number | null;
  readonly preview?: Record<string, unknown> | null;
  readonly options?: Record<string, unknown> | null;
  readonly expiresAt?: Date | null;
}

export interface JobPatch {
  readonly status?: MigrationJobStatus;
  readonly fileKey?: string | null;
  readonly fileName?: string | null;
  readonly fileBytes?: number | null;
  readonly options?: Record<string, unknown> | null;
  readonly progress?: MigrationProgressJson | null;
  readonly preview?: Record<string, unknown> | null;
  readonly summary?: Record<string, unknown> | null;
  readonly errorCode?: string | null;
  readonly startedAt?: Date | null;
  readonly finishedAt?: Date | null;
  readonly expiresAt?: Date | null;
  readonly deletedAt?: Date | null;
  readonly emailChoice?: MigrationEmailChoice | null;
  readonly emailsSentAt?: Date | null;
}

export const historyLimit = 20;

export function createJobStore(db: Database) {
  return {
    async create(communityId: string, job: NewJob): Promise<MigrationJob> {
      return inMigrationScope(db, communityId, async ({ tx, values }) => {
        const [row] = await tx
          .insert(migrationJobs)
          .values(values({ id: job.id ?? newId(), ...job }))
          .returning();
        if (!row) {
          throw new Error("migration job insert returned no row");
        }
        return row;
      });
    },

    async get(communityId: string, jobId: string): Promise<MigrationJob | null> {
      return inMigrationScope(db, communityId, async ({ tx, where }) => {
        const [row] = await tx
          .select()
          .from(migrationJobs)
          .where(where(migrationJobs, eq(migrationJobs.id, jobId)))
          .limit(1);
        return row ?? null;
      });
    },

    async list(communityId: string, limit = historyLimit): Promise<MigrationJob[]> {
      return inMigrationScope(db, communityId, ({ tx, where }) =>
        tx
          .select()
          .from(migrationJobs)
          .where(where(migrationJobs))
          .orderBy(desc(migrationJobs.createdAt), desc(migrationJobs.id))
          .limit(limit),
      );
    },

    async update(communityId: string, jobId: string, patch: JobPatch): Promise<void> {
      await inMigrationScope(db, communityId, async ({ tx, where }) => {
        await tx
          .update(migrationJobs)
          .set(patch)
          .where(where(migrationJobs, eq(migrationJobs.id, jobId)));
      });
    },

    async transition(
      communityId: string,
      jobId: string,
      from: readonly MigrationJobStatus[],
      patch: JobPatch & { readonly status: MigrationJobStatus },
    ): Promise<MigrationJob | null> {
      return inMigrationScope(db, communityId, async ({ tx, where }) => {
        const [row] = await tx
          .update(migrationJobs)
          .set(patch)
          .where(
            where(
              migrationJobs,
              and(eq(migrationJobs.id, jobId), inArray(migrationJobs.status, [...from])),
            ),
          )
          .returning();
        return row ?? null;
      });
    },

    async claimLaterEmails(
      communityId: string,
      jobId: string,
      at: Date,
    ): Promise<MigrationJob | null> {
      return inMigrationScope(db, communityId, async ({ tx, where }) => {
        const [row] = await tx
          .update(migrationJobs)
          .set({ emailsSentAt: at })
          .where(
            where(
              migrationJobs,
              and(
                eq(migrationJobs.id, jobId),
                eq(migrationJobs.status, "succeeded"),
                eq(migrationJobs.emailChoice, "later"),
                isNull(migrationJobs.emailsSentAt),
              ),
            ),
          )
          .returning();
        return row ?? null;
      });
    },

    async remove(
      communityId: string,
      jobId: string,
      from: readonly MigrationJobStatus[],
    ): Promise<MigrationJob | null> {
      return inMigrationScope(db, communityId, async ({ tx, where }) => {
        const [row] = await tx
          .delete(migrationJobs)
          .where(
            where(
              migrationJobs,
              and(eq(migrationJobs.id, jobId), inArray(migrationJobs.status, [...from])),
            ),
          )
          .returning();
        return row ?? null;
      });
    },

    async listStuck(communityId: string, startedBefore: Date): Promise<MigrationJob[]> {
      return inMigrationScope(db, communityId, ({ tx, where }) =>
        tx
          .select()
          .from(migrationJobs)
          .where(
            where(
              migrationJobs,
              and(eq(migrationJobs.status, "running"), lte(migrationJobs.startedAt, startedBefore)),
            ),
          ),
      );
    },

    async listExpired(communityId: string, now: Date): Promise<MigrationJob[]> {
      return inMigrationScope(db, communityId, ({ tx, where }) =>
        tx
          .select()
          .from(migrationJobs)
          .where(
            where(
              migrationJobs,
              and(
                lte(migrationJobs.expiresAt, now),
                isNull(migrationJobs.deletedAt),
                notInArray(migrationJobs.status, ["queued", "running"]),
              ),
            ),
          ),
      );
    },

    async hasActive(communityId: string, kind: MigrationJobKind): Promise<boolean> {
      return inMigrationScope(db, communityId, async ({ tx, where }) => {
        const rows = await tx
          .select({ id: migrationJobs.id })
          .from(migrationJobs)
          .where(
            where(
              migrationJobs,
              and(
                eq(migrationJobs.kind, kind),
                inArray(migrationJobs.status, ["queued", "running"]),
              ),
            ),
          )
          .limit(1);
        return rows.length > 0;
      });
    },
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
