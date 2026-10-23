import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export function parseDatabaseEnv(env: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  return databaseEnvSchema.parse(env);
}

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const count = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(fallback));

const millis = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(fallback));

export type PoolRole = "web" | "worker";

const defaultStatementTimeoutMs: Record<PoolRole, number> = { web: 60_000, worker: 0 };

const poolEnvSchema = (role: PoolRole) =>
  z
    .object({
      DB_POOL_MAX: count(10),
      DB_CONNECTION_TIMEOUT_MS: millis(10_000),
      DB_STATEMENT_TIMEOUT_MS: millis(defaultStatementTimeoutMs[role]),
      DB_IDLE_IN_TX_TIMEOUT_MS: millis(60_000),
      PGBOSS_POOL_MAX: count(3),
    })
    .transform((env) => ({
      max: env.DB_POOL_MAX,
      connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs: env.DB_IDLE_IN_TX_TIMEOUT_MS,
      queueMax: env.PGBOSS_POOL_MAX,
    }));

export type PoolEnv = z.infer<ReturnType<typeof poolEnvSchema>>;

export function parsePoolEnv(
  env: NodeJS.ProcessEnv = process.env,
  role: PoolRole = "web",
): PoolEnv {
  return poolEnvSchema(role).parse(env);
}

const adminDatabaseEnvSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    DATABASE_ADMIN_URL: postgresUrl.optional(),
  })
  .transform((env) => ({
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_ADMIN_URL: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
  }));

export type AdminDatabaseEnv = z.infer<typeof adminDatabaseEnvSchema>;

export function parseAdminDatabaseEnv(env: NodeJS.ProcessEnv = process.env): AdminDatabaseEnv {
  return adminDatabaseEnvSchema.parse(env);
}
