import {
  markUnverifiedAccountsVerified,
  summarizeUnverifiedAccounts,
  type UnverifiedAccounts,
} from "@cohory/auth/accounts";
import { getDb } from "@cohory/db";

import { parseAccountsCommand } from "./accounts-command";

const usage = `Usage:
  pnpm accounts mark-verified --created-before <ISO time> [--dry-run | --yes]
      count every account created before that time whose email is not confirmed.
      Nothing changes unless you add --yes, which marks those accounts as confirmed and writes
      an entry to each account's audit log. Use the time you turned on email sending.`;

function report(mode: "dry-run" | "applied", accounts: UnverifiedAccounts): string {
  return JSON.stringify({
    mode,
    count: accounts.count,
    earliestCreatedAt: accounts.earliestCreatedAt?.toISOString() ?? null,
    latestCreatedAt: accounts.latestCreatedAt?.toISOString() ?? null,
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const command = parseAccountsCommand(argv);
  if (!command) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  if (!command.apply) {
    const preview = await summarizeUnverifiedAccounts(getDb(), command.createdBefore);
    process.stdout.write(`${report("dry-run", preview)}\nRun again with --yes to mark them.\n`);
    return 0;
  }
  const marked = await markUnverifiedAccountsVerified(getDb(), command.createdBefore);
  process.stdout.write(`${report("applied", marked)}\n`);
  return 0;
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error: unknown) {
  const name = error instanceof Error ? error.name : "unknown";
  console.error(JSON.stringify({ level: "error", msg: "accounts command failed", error: name }));
  process.exit(1);
}
