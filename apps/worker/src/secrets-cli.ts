import { rotateStoredPaymentSecrets } from "@cohory/payments";
import { rotateStoredWebhookSecrets } from "@cohory/webhooks";

const usage = `Usage:
  pnpm secrets rotate    re-encrypt stored payment and webhook secrets with the first key
                         of PAYMENTS_ENCRYPTION_KEYS and WEBHOOKS_ENCRYPTION_KEYS`;

async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] !== "rotate") {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const payments = await rotateStoredPaymentSecrets();
  const webhooks = await rotateStoredWebhookSecrets();
  process.stdout.write(`${JSON.stringify({ payments, webhooks }, null, 2)}\n`);
  const unreadable = (payments?.unreadable.length ?? 0) + webhooks.unreadable.length;
  return unreadable > 0 ? 1 : 0;
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error: unknown) {
  const name = error instanceof Error ? error.name : "unknown";
  console.error(JSON.stringify({ level: "error", msg: "secrets command failed", error: name }));
  process.exit(1);
}
