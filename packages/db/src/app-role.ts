import type { Pool } from "pg";

import { migrationLockKey } from "./migrations";

const roleNamePattern = /^[a-z_][a-z0-9_]*$/;

export interface AppRole {
  readonly name: string;
  readonly password: string;
}

export class InvalidRoleNameError extends Error {
  constructor(name: string) {
    super(`invalid role name: ${name}`);
    this.name = "InvalidRoleNameError";
  }
}

function ident(name: string): string {
  if (!roleNamePattern.test(name)) {
    throw new InvalidRoleNameError(name);
  }
  return `"${name}"`;
}

export function appRoleFromUrls(appUrl: string, adminUrl: string): AppRole | null {
  const app = new URL(appUrl);
  const admin = new URL(adminUrl);
  if (app.username === admin.username) {
    return null;
  }
  return { name: decodeURIComponent(app.username), password: decodeURIComponent(app.password) };
}

export async function ensureAppRole(pool: Pool, role: AppRole): Promise<void> {
  const name = ident(role.name);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [migrationLockKey]);
    const { rows } = await client.query<{ statement: string }>(
      `select format(
         '%s role %I with login nosuperuser nobypassrls nocreatedb nocreaterole password %L',
         case when exists (select 1 from pg_roles where rolname = $1) then 'alter' else 'create' end,
         $1::text,
         $2::text
       ) as statement`,
      [role.name, role.password],
    );
    const statement = rows[0]?.statement;
    if (!statement) {
      throw new Error("role statement was not built");
    }
    await client.query(statement);
    await client.query(
      `grant create on database ${ident(await currentDatabase(client))} to ${name}`,
    );
    await client.query(`grant usage on schema public to ${name}`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema public to ${name}`,
    );
    await client.query(
      `alter default privileges in schema public grant select, insert, update, delete on tables to ${name}`,
    );
    await client.query("commit");
  } catch (error: unknown) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function currentDatabase(client: { query: Pool["query"] }): Promise<string> {
  const { rows } = await client.query<{ name: string }>("select current_database() as name");
  const name = rows[0]?.name;
  if (!name) {
    throw new Error("current database is unknown");
  }
  return name;
}
