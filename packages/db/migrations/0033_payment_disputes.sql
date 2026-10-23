CREATE TYPE "public"."fee_ledger_reason" AS ENUM('dispute_lost');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_status" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_disputed';--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD COLUMN "reason" "fee_ledger_reason";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "dispute_status" "payment_dispute_status";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_ledger_entries" ADD CONSTRAINT "fee_ledger_entries_reason_kind" CHECK ("fee_ledger_entries"."reason" is null or "fee_ledger_entries"."kind" = 'fee_refunded');--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_dispute_consistent" CHECK (("payments"."dispute_status" is null) = ("payments"."disputed_at" is null));