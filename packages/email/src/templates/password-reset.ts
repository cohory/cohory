import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { formatDuration } from "./html";
import { buildEmail } from "./layout";

type PasswordResetInput = {
  name: string;
  url: string;
  expiresInMinutes: number;
};

export function passwordResetEmail({
  name,
  url,
  expiresInMinutes,
}: PasswordResetInput): EmailContent {
  const instance = instanceName();
  const duration = formatDuration(expiresInMinutes);
  return buildEmail({
    template: "password-reset",
    subject: `Reset your ${instance} password`,
    preheader: `The link works for ${duration}.`,
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `We received a request to reset the password for your ${instance} account. Open this link to choose a new password:`,
    ],
    cta: { label: "Choose a new password", url },
    after: [
      `The link works for ${duration}. If you did not ask for this, you can ignore this email. Your password stays the same.`,
    ],
  });
}
