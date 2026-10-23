import { createDb, createPool, parseAdminDatabaseEnv } from "@cohory/db";

import { parsePaymentsEnv } from "./config";
import { paidSeedAccountId, paidSeedSecretKey, seedDevPaidPayments } from "./seed-paid";
import { createStripeGateway } from "./stripe-gateway";

const secretKeyPattern = /\b(sk|rk)_(test|live)_[A-Za-z0-9*]+/g;

function redacted(text: string): string {
  return text.replace(secretKeyPattern, "[redacted key]");
}

async function main(): Promise<void> {
  const secretKey = paidSeedSecretKey(process.env);
  const accountId = paidSeedAccountId(process.env);
  const env = parsePaymentsEnv();
  const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
  try {
    const result = await seedDevPaidPayments({
      db: createDb(pool),
      env,
      accountId,
      gateway: createStripeGateway(secretKey, { apiBaseUrl: env.stripeApiBaseUrl }),
    });
    console.info(JSON.stringify({ level: "info", msg: "paid seed applied", ...result }));
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "paid seed refused or failed",
        name: error instanceof Error ? error.name : "unknown",
        reason: redacted(error instanceof Error ? error.message : String(error)),
      }),
    );
    process.exit(1);
  },
);
