import { z } from "zod";

import { emailTemplateIds } from "./templates/ids";

export const emailMessageSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
  headers: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/), z.string()).optional(),
  template: z.enum(emailTemplateIds).optional(),
  communityId: z.uuid().optional(),
  calendarInvite: z
    .object({ method: z.enum(["REQUEST", "CANCEL"]), content: z.string().min(1).max(200_000) })
    .optional(),
  fromName: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[^\r\n]*$/)
    .optional(),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

export type EmailContent = Omit<EmailMessage, "to">;

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
