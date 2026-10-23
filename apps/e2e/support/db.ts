import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "@playwright/test";

const run = promisify(execFile);
const project = process.env.COMPOSE_PROJECT_NAME ?? "cohorye2e";
const databaseUser = process.env.E2E_POSTGRES_USER ?? "cohory";
const databaseName = process.env.E2E_POSTGRES_DB ?? "cohory";
const hostLogDirectory = process.env.E2E_LOG_DIR;

let container: Promise<string> | undefined;

async function serviceContainer(service: string): Promise<string> {
  const { stdout } = await run("docker", [
    "ps",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ]);
  const id = stdout.trim().split("\n")[0];
  if (!id) throw new Error(`no ${service} container in Compose project ${project}`);
  return id;
}

function postgresContainer(): Promise<string> {
  return serviceContainer("postgres");
}

// `pnpm e2e:host` runs the app as plain processes that write one log file per service.
export async function serviceLogs(service: string): Promise<string> {
  if (hostLogDirectory) return readFile(join(hostLogDirectory, `${service}.log`), "utf8");
  const { stdout, stderr } = await run(
    "docker",
    ["logs", "--since", "30m", await serviceContainer(service)],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

// The suite owns its Compose stack, so running psql inside its postgres container keeps the
// tests hermetic, needs no psql on the host, and still lets them move clocks and run jobs the
// worker schedules hourly.
export async function query(sql: string): Promise<string[][]> {
  container ??= postgresContainer();
  const { stdout } = await run("docker", [
    "exec",
    await container,
    "psql",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "-v",
    "ON_ERROR_STOP=1",
    "-AtF",
    "\t",
    "-c",
    sql,
  ]);
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

export async function userIdOf(email: string): Promise<string> {
  const [row] = await query(`select id from users where email = '${email.replace(/'/g, "''")}'`);
  if (!row?.[0]) throw new Error(`no user with email ${email}`);
  return row[0];
}

export async function enqueueJob(name: string): Promise<void> {
  const [row] = await query(
    `insert into pgboss.job (name, data) values ('${name}', '{}') returning id`,
  );
  const id = row?.[0];
  if (!id) throw new Error(`job ${name} was not queued`);
  await expect
    .poll(
      async () => {
        const [state] = await query(`select state from pgboss.job where id = '${id}'`);
        return state?.[0];
      },
      { message: `job ${name} completes`, timeout: 60_000 },
    )
    .toBe("completed");
}
