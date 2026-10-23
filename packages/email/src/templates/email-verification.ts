import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { formatDuration } from "./html";
import { buildEmail } from "./layout";

type EmailVerificationInput = {
  name: string;
  url: string;
  expiresInMinutes?: number;
};

export function emailVerificationEmail({
  name,
  url,
  expiresInMinutes = 60,
}: EmailVerificationInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "email-verification",
    subject: "Confirm your email address",
    preheader: `One click so ${instance} can reach you.`,
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `Confirm that this is your email address so we can reach you about your ${instance} account:`,
    ],
    cta: { label: "Confirm email address", url },
    after: [
      `The link works for ${formatDuration(expiresInMinutes)}. If you did not ask for this, you can ignore this email.`,
    ],
  });
}
