import { createPool } from "./client";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const developmentPort = "5433";
const databaseNamePattern = /^[A-Za-z0-9_]{1,63}$/;

export class DevelopmentDatabaseError extends Error {
  readonly code = "development_database_refused";

  constructor(url: URL) {
    super(
      `Integration tests refuse the development database on ${url.hostname}:${url.port}. ` +
        "Run them through scripts/test-integration.sh (shared test services stack), point " +
        "DATABASE_URL at a throwaway Postgres, or set COHORY_TEST_ALLOW_DEV_DB=1 on purpose.",
    );
  }
}

export function assertTestDatabase(databaseUrl: string, env: NodeJS.ProcessEnv): void {
  const url = new URL(databaseUrl);
  const isDevelopment = localHosts.has(url.hostname) && url.port === developmentPort;
  if (isDevelopment && env.CI !== "true" && env.COHORY_TEST_ALLOW_DEV_DB !== "1") {
    throw new DevelopmentDatabaseError(url);
  }
}

export function testDatabaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseNamePattern.test(name)) {
    throw new Error(`Unsupported test database name "${name}": use letters, digits, and _`);
  }
  return name;
}

export function maintenanceUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

const duplicateDatabase = "42P04";
const unknownDatabase = "3D000";

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function databaseExists(databaseUrl: string): Promise<boolean> {
  const pool = createPool(databaseUrl);
  try {
    await pool.query("select 1");
    return true;
  } catch (error) {
    if (hasCode(error, unknownDatabase)) {
      return false;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

export async function ensureTestDatabase(databaseUrl: string): Promise<void> {
  const name = testDatabaseName(databaseUrl);
  if (await databaseExists(databaseUrl)) {
    return;
  }
  const pool = createPool(maintenanceUrl(databaseUrl));
  try {
    await pool.query(`create database "${name}"`);
  } catch (error) {
    if (!hasCode(error, duplicateDatabase)) {
      throw error;
    }
  } finally {
    await pool.end();
  }
}
