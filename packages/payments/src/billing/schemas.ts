import { z } from "zod";

export const billingEmailInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export type BillingEmailInput = z.input<typeof billingEmailInputSchema>;

export const setupSessionIdSchema = z
  .string()
  .regex(/^cs_[A-Za-z0-9_]+$/)
  .max(255);

export const invoiceHistoryLimit = 24;
