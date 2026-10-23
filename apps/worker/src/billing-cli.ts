import { communityIdSchema } from "@cohory/db";
import { getPaymentsService } from "@cohory/payments";
import { getPlatformBillingService, periodStarting } from "@cohory/payments/billing";
import { z } from "zod";

const usage = `Usage:
  pnpm billing invoice [YYYY-MM]          issue invoices for a closed month (default: last month)
  pnpm billing reconcile                  sync open invoices and check totals
  pnpm billing sync <communityId> <invoiceId>
  pnpm billing resend <communityId> <invoiceId>
  pnpm billing void <communityId> <invoiceId>
  pnpm billing replay-webhook <eventId>   queue one stored Stripe webhook event again`;

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const invoiceArgs = z.tuple([communityIdSchema, z.uuid()]);
const eventArgs = z.tuple([z.string().regex(/^evt_[A-Za-z0-9_]+$/)]);

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const service = getPlatformBillingService();
  switch (command) {
    case "invoice": {
      const month = rest[0] ? monthSchema.parse(rest[0]) : null;
      const period = month ? periodStarting(new Date(`${month}-01T00:00:00.000Z`)) : undefined;
      print(await service.generateInvoices(period ? { period } : {}));
      return 0;
    }
    case "reconcile":
      print(await service.reconcile());
      return 0;
    case "replay-webhook": {
      const [eventId] = eventArgs.parse(rest);
      const result = await getPaymentsService().replayWebhookEvent(eventId);
      print(result);
      return result.kind === "not_found" ? 1 : 0;
    }
    case "sync":
    case "resend":
    case "void": {
      const [communityId, invoiceId] = invoiceArgs.parse(rest);
      const run = {
        sync: service.syncPlatformInvoice,
        resend: service.resendPlatformInvoice,
        void: service.voidPlatformInvoice,
      }[command];
      const invoice = await run(communityId, invoiceId);
      print(
        invoice
          ? { id: invoice.id, status: invoice.status, stripeInvoiceId: invoice.stripeInvoiceId }
          : null,
      );
      return invoice ? 0 : 1;
    }
    default:
      process.stderr.write(`${usage}\n`);
      return 2;
  }
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error: unknown) {
  const name = error instanceof Error ? error.name : "unknown";
  console.error(JSON.stringify({ level: "error", msg: "billing command failed", error: name }));
  process.exit(1);
}
